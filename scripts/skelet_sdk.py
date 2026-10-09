"""Skelet Python SDK: a thin typed client over REST API v1.

Standard library only (urllib). Mirrors the TypeScript SDK read surface:
unified asset search, single-asset resolution, and canonical object
recovery by stable Skelet URI. Transport failures surface as typed
SdkError codes, never raw responses. Redirects are refused rather than
followed so bearer tokens cannot leak to redirect targets.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

SDK_CONTRACT_VERSION = "v1"

_ERROR_CODES = {
    401: "sdk/unauthorized",
    403: "sdk/forbidden",
    404: "sdk/not-found",
    429: "sdk/rate-limited",
}


class SdkError(Exception):
    def __init__(self, code: str, status: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


class _RefuseRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001,ANN202
        raise SdkError("sdk/transport", 0, "Redirects are refused.")


def _build_opener(timeout: float) -> urllib.request.OpenerDirector:
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
    return base


class SkeletClient:
    """Typed read client for REST API v1."""

    def __init__(self, base_url: str, token: str, timeout: float = 30.0) -> None:
        self.base_url = _validate_base_url(base_url)
        if not isinstance(token, str) or not token:
            raise SdkError("sdk/invalid", 0, "Token is invalid.")
        if not isinstance(timeout, (int, float)) or timeout <= 0 or timeout > 300:
            raise SdkError("sdk/invalid", 0, "Timeout is invalid.")
        self._token = token
        self._timeout = float(timeout)
        self._opener = _build_opener(self._timeout)

    def _request(self, path: str, query: dict[str, str] | None = None):
        url = self.base_url + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        request = urllib.request.Request(
            url, headers={"Authorization": f"Bearer {self._token}"}
        )
        try:
            with self._opener.open(request, timeout=self._timeout) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except SdkError:
            raise
        except urllib.error.HTTPError as error:
            code = _ERROR_CODES.get(error.code)
            if code is None:
                code = "sdk/invalid" if 400 <= error.code < 500 else "sdk/transport"
            raise SdkError(code, error.code, f"Request failed with status {error.code}.") from error
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            raise SdkError("sdk/transport", 0, "Request failed.") from error

    def search_assets(self, query: str, kinds: str | None = None, limit: int | None = None):
        """Unified search across icons, logos, and fonts."""
        if not isinstance(query, str) or not query.strip():
            raise SdkError("sdk/invalid", 0, "Query is invalid.")
        params: dict[str, str] = {"query": query}
        if kinds is not None:
            params["kinds"] = kinds
        if limit is not None:
            params["limit"] = str(limit)
        _status, body = self._request("/api/v1/assets", params)
        if not isinstance(body, dict) or not isinstance(body.get("assets"), list):
            raise SdkError("sdk/transport", 0, "Response shape is invalid.")
        return body["assets"]

    def get_asset(self, artifact_id: str):
        """Resolve one asset record with provenance and policy."""
        if not isinstance(artifact_id, str) or not artifact_id:
            raise SdkError("sdk/invalid", 0, "Artifact ID is invalid.")
        _status, body = self._request(f"/api/v1/assets/{urllib.parse.quote(artifact_id, safe='')}")
        if not isinstance(body, dict) or not isinstance(body.get("asset"), dict):
            raise SdkError("sdk/transport", 0, "Response shape is invalid.")
        return body["asset"]

    def get_object(self, uri: str):
        """Retrieve a canonical object by stable Skelet URI."""
        if not isinstance(uri, str) or not uri:
            raise SdkError("sdk/invalid", 0, "URI is invalid.")
        _status, body = self._request("/api/v1/objects", {"uri": uri})
        if not isinstance(body, dict):
            raise SdkError("sdk/transport", 0, "Response shape is invalid.")
        has_object = isinstance(body.get("object"), dict)
        has_pack = isinstance(body.get("pack"), dict)
        if has_object == has_pack:
            raise SdkError("sdk/transport", 0, "Response shape is invalid.")
        return body.get("object") if has_object else body.get("pack")
