"""Skelet Python SDK: a thin typed client over REST API v1.

Standard library only (urllib). Mirrors the TypeScript SDK read surface:
unified asset search, single-asset resolution, and canonical object
recovery by stable Skelet URI. Transport failures surface as typed
SdkError codes, never raw responses. Redirects are refused rather than
followed so bearer tokens cannot leak to redirect targets.
"""

from __future__ import annotations

import http.client
import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request

SDK_CONTRACT_VERSION = "v1"
RESPONSE_MAX_BYTES = 8 << 20
TOKEN_PATTERN = re.compile(r"[^\s\x00-\x1f\x7f]+")

_ERROR_CODES = {
    401: "sdk/unauthorized",
    403: "sdk/forbidden",
    404: "sdk/not-found",
    429: "sdk/rate-limited",
}


class SdkError(Exception):
    def __init__(
        self,
        code: str,
        status: int,
        message: str,
        *,
        retryable: bool | None = None,
        request_id: str | None = None,
        envelope_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.retryable = retryable if retryable is not None else (code == "sdk/rate-limited")
        self.request_id = request_id
        self.envelope_code = envelope_code


def _envelope_result(body: object) -> dict | None:
    """Unwrap skelet.agent.v1 envelope, else accept bare pre-AF-03b shape."""
    if not isinstance(body, dict):
        return None
    if body.get("schema_version") == "skelet.agent.v1" and isinstance(body.get("result"), dict):
        result = body["result"]
        return result if isinstance(result, dict) else None
    return body


def _envelope_meta(body: object) -> dict:
    """Extract request_id, cursor, warnings, and typed error from an envelope."""
    meta: dict = {"warnings": []}
    if not isinstance(body, dict):
        return meta
    request_id = body.get("request_id")
    if isinstance(request_id, str) and request_id:
        meta["request_id"] = request_id
    cursor = body.get("cursor")
    if isinstance(cursor, str) and cursor:
        meta["cursor"] = cursor
    warnings = body.get("warnings")
    if isinstance(warnings, list):
        meta["warnings"] = [w for w in warnings if isinstance(w, str) and w]
    error = body.get("error")
    if isinstance(error, dict):
        if isinstance(error.get("code"), str):
            meta["error_code"] = error["code"]
        if isinstance(error.get("message"), str):
            meta["error_message"] = error["message"]
        if isinstance(error.get("retryable"), bool):
            meta["retryable"] = error["retryable"]
    return meta


_ENVELOPE_TO_SDK = {
    "UNAUTHENTICATED": "sdk/unauthorized",
    "RIGHTS_RESTRICTED": "sdk/forbidden",
    "FORBIDDEN_OR_NOT_FOUND": "sdk/not-found",
    "RATE_LIMITED": "sdk/rate-limited",
    "QUOTA_EXCEEDED": "sdk/rate-limited",
    "INVALID_INPUT": "sdk/invalid",
}


def _sdk_code_for_envelope(envelope_code: str | None, status: int) -> str:
    if isinstance(envelope_code, str) and envelope_code in _ENVELOPE_TO_SDK:
        mapped = _ENVELOPE_TO_SDK[envelope_code]
        return mapped if isinstance(mapped, str) else "sdk/transport"
    if status in _ERROR_CODES:
        mapped = _ERROR_CODES[status]
        return mapped if isinstance(mapped, str) else "sdk/transport"
    if 400 <= status < 500:
        return "sdk/invalid"
    return "sdk/transport"


class _RefuseRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001,ANN202
        raise SdkError("sdk/transport", 0, "Redirects are refused.")


def _build_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(_RefuseRedirects)


def _validate_base_url(base_url: str) -> str:
    if not isinstance(base_url, str):
        raise SdkError("sdk/invalid", 0, "Base URL is invalid.")
    base = base_url.strip().rstrip("/")
    try:
        parsed = urllib.parse.urlparse(base)
    except ValueError as error:
        raise SdkError("sdk/invalid", 0, "Base URL is invalid.") from error
    if parsed.scheme not in ("https", "http") or not parsed.hostname:
        raise SdkError("sdk/invalid", 0, "Base URL is invalid.")
    if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise SdkError("sdk/invalid", 0, "Base URL must use HTTPS outside localhost.")
    if parsed.username or parsed.password:
        raise SdkError("sdk/invalid", 0, "Base URL must not embed credentials.")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise SdkError("sdk/invalid", 0, "Base URL must not carry a path.")
    return base


class SkeletClient:
    """Typed read client for REST API v1."""

    def __init__(self, base_url: str, token: str, timeout: float = 30.0) -> None:
        self.base_url = _validate_base_url(base_url)
        if not isinstance(token, str) or TOKEN_PATTERN.fullmatch(token) is None:
            raise SdkError("sdk/invalid", 0, "Token is invalid.")
        if (
            not isinstance(timeout, (int, float))
            or isinstance(timeout, bool)
            or not math.isfinite(timeout)
            or not 0 < timeout <= 300
        ):
            raise SdkError("sdk/invalid", 0, "Timeout is invalid.")
        self._token = token
        self._timeout = float(timeout)
        self._opener = _build_opener()

    def _request(
        self,
        path: str,
        query: dict[str, str] | None = None,
        *,
        request_id: str | None = None,
    ):
        url = self.base_url + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        headers = {"Authorization": f"Bearer {self._token}"}
        if isinstance(request_id, str) and request_id:
            headers["X-Request-Id"] = request_id[:128]
        request = urllib.request.Request(url, headers=headers)
        try:
            with self._opener.open(request, timeout=self._timeout) as response:
                raw = response.read(RESPONSE_MAX_BYTES + 1)
                if len(raw) > RESPONSE_MAX_BYTES:
                    raise SdkError("sdk/transport", 0, "Response is too large.")
                return response.status, json.loads(raw.decode("utf-8"))
        except SdkError:
            raise
        except urllib.error.HTTPError as error:
            envelope_code: str | None = None
            retryable: bool | None = None
            response_request_id: str | None = None
            try:
                raw_error = error.read(RESPONSE_MAX_BYTES + 1)
                error_body = json.loads(raw_error.decode("utf-8")) if raw_error else None
                meta = _envelope_meta(error_body)
                envelope_code = meta.get("error_code")
                retryable = meta.get("retryable")
                response_request_id = meta.get("request_id")
            except Exception:
                pass
            code = _sdk_code_for_envelope(envelope_code, error.code)
            if retryable is None:
                retryable = code == "sdk/rate-limited"
            raise SdkError(
                code,
                error.code,
                f"Request failed with status {error.code}.",
                retryable=retryable,
                request_id=response_request_id,
                envelope_code=envelope_code,
            ) from error
        except (urllib.error.URLError, TimeoutError, ValueError, OSError, http.client.HTTPException) as error:
            raise SdkError("sdk/transport", 0, "Request failed.") from error

    def search_assets_page(
        self,
        query: str,
        kinds: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
        request_id: str | None = None,
    ) -> dict:
        """Cursor-aware search page.

        Reads are safe to retry: the same cursor and limit deterministically
        return the same slice. Returns {"assets", "cursor", "request_id",
        "warnings"} so independent clients share one pagination policy.
        """
        if not isinstance(query, str) or not query.strip():
            raise SdkError("sdk/invalid", 0, "Query is invalid.")
        params: dict[str, str] = {"query": query}
        if kinds is not None:
            params["kinds"] = kinds
        if limit is not None:
            params["limit"] = str(limit)
        if cursor is not None:
            params["cursor"] = cursor
        _status, body = self._request("/api/v1/assets", params, request_id=request_id)
        result = _envelope_result(body)
        if not isinstance(result, dict) or not isinstance(result.get("assets"), list):
            raise SdkError("sdk/transport", 0, "Response shape is invalid.")
        meta = _envelope_meta(body)
        return {
            "assets": result["assets"],
            "cursor": meta.get("cursor"),
            "request_id": meta.get("request_id"),
            "warnings": meta.get("warnings", []),
        }

    def search_assets(self, query: str, kinds: str | None = None, limit: int | None = None, cursor: str | None = None, request_id: str | None = None):
        """Unified search across icons, logos, and fonts."""
        return self.search_assets_page(query, kinds=kinds, limit=limit, cursor=cursor, request_id=request_id)["assets"]

    def get_asset(self, artifact_id: str, request_id: str | None = None):
        """Resolve one asset record with provenance and policy."""
        if not isinstance(artifact_id, str) or not artifact_id:
            raise SdkError("sdk/invalid", 0, "Artifact ID is invalid.")
        _status, body = self._request(
            f"/api/v1/assets/{urllib.parse.quote(artifact_id, safe='')}", request_id=request_id
        )
        result = _envelope_result(body)
        if not isinstance(result, dict) or not isinstance(result.get("asset"), dict):
            raise SdkError("sdk/transport", 0, "Response shape is invalid.")
        return result["asset"]

    def get_object(self, uri: str, request_id: str | None = None):
        """Retrieve a canonical object by stable Skelet URI.

        Returns the server result object unchanged ({"object": ...} or
        {"pack": ...}) unwrapped from the skelet.agent.v1 envelope so
        callers branch on result keys instead of heuristic fields.
        """
        if not isinstance(uri, str) or not uri:
            raise SdkError("sdk/invalid", 0, "URI is invalid.")
        _status, body = self._request("/api/v1/objects", {"uri": uri}, request_id=request_id)
        result = _envelope_result(body)
        if not isinstance(result, dict):
            raise SdkError("sdk/transport", 0, "Response shape is invalid.")
        present = {key for key in ("object", "pack") if isinstance(result.get(key), dict)}
        if len(present) != 1:
            raise SdkError("sdk/transport", 0, "Response shape is invalid.")
        return result
