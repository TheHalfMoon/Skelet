import io
import json
import os
import subprocess
import sys
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

from scripts.skilit_sdk import SDK_CONTRACT_VERSION, SdkError, SkilitClient

ROOT = Path(__file__).resolve().parents[1]
ASSET = {
    "uri": "skilit://artifact/1",
    "kind": "icon",
    "title": "Arrow",
    "license": "MIT",
    "rights": "permitted",
    "serving": "download",
    "servingReason": "ok",
    "source": "s",
    "contentHash": "a" * 64,
}


@contextmanager
def stubbed(routes, error=None):
    """Replace opener transport with a deterministic offline double."""
    calls = []

    def open_request(self, url, data=None, timeout=None, **kwargs):
        calls.append(url)
        request = url
        if error is not None:
            raise error
        body = routes.get(request.full_url.split("?", 1)[0])
        if body is None:
            raise AssertionError(f"unexpected URL: {request.full_url}")
        payload = json.dumps(body).encode("utf-8")

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self, size=-1):
                return payload if size is None or size < 0 else payload[:size]

        return Response()

    with mock.patch.object(urllib.request.OpenerDirector, "open", open_request):
        yield calls


def make_client(**kwargs):
    options = {"base_url": "https://skilit.test", "token": "secret"}
    options.update(kwargs)
    return SkilitClient(options["base_url"], options["token"], **{k: v for k, v in kwargs.items() if k not in ("base_url", "token")})


class SdkClientTests(unittest.TestCase):
    def test_constructor_validation(self) -> None:
        with self.assertRaises(SdkError):
            SkilitClient("", "t")
        with self.assertRaises(SdkError):
            SkilitClient("https://x", "")
        with self.assertRaises(SdkError):
            SkilitClient("http://example.com", "t")
        with self.assertRaises(SdkError):
            SkilitClient("https://user:pass@x", "t")
        with self.assertRaises(SdkError):
            SkilitClient("https://x", "t", timeout=-1)
        self.assertEqual(SDK_CONTRACT_VERSION, "v1")
        self.assertTrue(make_client().base_url.endswith("https://skilit.test"))

    def test_search_shapes_requests(self) -> None:
        with stubbed({"https://skilit.test/api/v1/assets": {"assets": [ASSET]}}) as calls:
            assets = make_client().search_assets("arrow", kinds="icon", limit=5)
        self.assertEqual([ASSET], assets)
        request = calls[0]
        self.assertIn("query=arrow", request.full_url)
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")
        with stubbed({}):
            with self.assertRaises(SdkError):
                make_client().search_assets("   ")

    def test_get_and_object_recovery(self) -> None:
        routes = {
            "https://skilit.test/api/v1/assets/abc": {"asset": ASSET},
            "https://skilit.test/api/v1/objects": {
                "object": {"uri": "skilit://artifact/abc", "kind": "icon", "title": "A", "rights": "permitted"}
            },
        }
        with stubbed(routes):
            self.assertEqual(make_client().get_asset("abc")["uri"], "skilit://artifact/1")
            envelope = make_client().get_object("skilit://artifact/abc")
            self.assertEqual(envelope["object"]["title"], "A")
            with self.assertRaises(SdkError):
                make_client().get_asset("")

    def test_status_taxonomy(self) -> None:
        for status, code in (
            (401, "sdk/unauthorized"),
            (403, "sdk/forbidden"),
            (404, "sdk/not-found"),
            (429, "sdk/rate-limited"),
            (400, "sdk/invalid"),
            (500, "sdk/transport"),
        ):
            with self.subTest(status=status):
                error = urllib.error.HTTPError(
                    "https://skilit.test/api/v1/assets", status, "boom", {}, io.BytesIO(b"{}")
                )
                with stubbed({}, error=error):
                    with self.assertRaises(SdkError) as caught:
                        make_client().search_assets("q")
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(caught.exception.status, status)

    def test_transport_failures_stay_typed(self) -> None:
        with stubbed({}, error=urllib.error.URLError("down")):
            with self.assertRaises(SdkError) as caught:
                make_client().search_assets("q")
        self.assertEqual(caught.exception.code, "sdk/transport")
        with stubbed({"https://skilit.test/api/v1/assets": {"nope": True}}):
            with self.assertRaises(SdkError) as caught:
                make_client().search_assets("q")
        self.assertEqual(caught.exception.code, "sdk/transport")

    def test_envelope_unwrap_with_cursor_and_request_id(self) -> None:
        envelope = {
            "schema_version": "skilit.agent.v1",
            "request_id": "req-py-001",
            "status": "complete",
            "result": {"assets": [ASSET]},
            "cursor": "Y3Vyc29y",
        }
        with stubbed({"https://skilit.test/api/v1/assets": envelope}):
            page = make_client().search_assets_page("arrow", cursor="Y3Vyc29y", request_id="req-py-001")
        self.assertEqual(page["assets"], [ASSET])
        self.assertEqual(page["cursor"], "Y3Vyc29y")
        self.assertEqual(page["request_id"], "req-py-001")
        with stubbed({"https://skilit.test/api/v1/assets": {"assets": [ASSET]}}):
            self.assertEqual(make_client().search_assets("arrow"), [ASSET])

    def test_envelope_errors_map_with_retryable(self) -> None:
        cases = (
            (401, {"schema_version": "skilit.agent.v1", "request_id": "r1", "status": "complete", "result": {},
                    "error": {"code": "UNAUTHENTICATED", "message": "Unauthorized.", "retryable": False}},
             "sdk/unauthorized", False),
            (403, {"schema_version": "skilit.agent.v1", "request_id": "r2", "status": "complete", "result": {},
                    "error": {"code": "RIGHTS_RESTRICTED", "message": "Content is rights-restricted.", "retryable": False}},
             "sdk/forbidden", False),
            (429, {"schema_version": "skilit.agent.v1", "request_id": "r3", "status": "complete", "result": {},
                    "error": {"code": "RATE_LIMITED", "message": "Rate limited.", "retryable": True}},
             "sdk/rate-limited", True),
        )
        for status, body, code, retryable in cases:
            with self.subTest(status=status):
                payload = json.dumps(body).encode("utf-8")
                error = urllib.error.HTTPError(
                    "https://skilit.test/api/v1/assets", status, "boom", {}, io.BytesIO(payload)
                )
                with stubbed({}, error=error):
                    with self.assertRaises(SdkError) as caught:
                        make_client().search_assets("q")
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(caught.exception.retryable, retryable)
                self.assertIsInstance(caught.exception.request_id, str)


class StubApiHandler(BaseHTTPRequestHandler):
    """Minimal in-process API double for CLI end-to-end proof."""

    protocol_version = "HTTP/1.1"

    def _send(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        if self.headers.get("Authorization") != "Bearer cli-secret":
            self._send(401, {"error": "Unauthorized."})
            return
        if self.path.startswith("/api/v1/redirect"):
            self.server.hits = getattr(self.server, "hits", 0) + 1  # type: ignore[attr-defined]
            self.send_response(302)
            self.send_header("Location", "/api/v1/assets?query=x")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        # AF-03c: the stub speaks the same skilit.agent.v1 envelope as the
        # real REST routes so the CLI E2E proves envelope interop, not just
        # bare-shape parsing. The SDK unwraps both shapes.
        if self.path.startswith("/api/v1/assets?"):
            self._send(200, {
                "schema_version": "skilit.agent.v1",
                "request_id": "req-cli-001",
                "status": "complete",
                "result": {"assets": [ASSET]},
            })
        elif self.path.startswith("/api/v1/assets/"):
            self._send(200, {
                "schema_version": "skilit.agent.v1",
                "request_id": "req-cli-002",
                "status": "complete",
                "result": {"asset": ASSET},
            })
        elif self.path.startswith("/api/v1/objects"):
            self._send(
                200,
                {
                    "schema_version": "skilit.agent.v1",
                    "request_id": "req-cli-003",
                    "status": "complete",
                    "result": {"pack": {"schema": "skilit/reference-pack/1", "uri": "skilit://collection/1", "items": []}},
                },
            )
        else:
            self._send(404, {"error": "Object was not found."})

    def log_message(self, *args) -> None:  # noqa: ANN001
        return


class CliEndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = HTTPServer(("127.0.0.1", 0), StubApiHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05})
        cls.thread.daemon = True
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.thread.join(timeout=5)
        cls.server.server_close()

    def _run(self, *args: str, extra_env: dict | None = None):
        merged = dict(os.environ)
        merged.update({"SKILIT_BASE_URL": f"http://127.0.0.1:{self.port}", "SKILIT_TOKEN": "cli-secret"})
        if extra_env:
            merged.update(extra_env)
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "skilit.py"), *args],
            capture_output=True,
            text=True,
            env=merged,
            timeout=60,
        )

    def test_search_get_object_round_trip(self) -> None:
        search = self._run("search", "--query", "arrow")
        self.assertEqual(search.returncode, 0, search.stderr)
        self.assertIn("skilit://artifact/1", search.stdout)
        get = self._run("get", "abc")
        self.assertEqual(get.returncode, 0, get.stderr)
        self.assertIn("MIT", get.stdout)
        recovered = self._run("object", "skilit://collection/1")
        self.assertEqual(recovered.returncode, 0, recovered.stderr)
        self.assertIn("skilit/reference-pack/1", recovered.stdout)

    def test_missing_credentials_fail_closed(self) -> None:
        merged = {key: value for key, value in os.environ.items() if not key.startswith("SKILIT_")}
        completed = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "skilit.py"), "search", "--query", "x"],
            capture_output=True,
            text=True,
            env=merged,
            timeout=60,
        )
        self.assertEqual(completed.returncode, 2)

    def test_unauthorized_surfaces_typed_error(self) -> None:
        completed = self._run("search", "--query", "x", extra_env={"SKILIT_TOKEN": "wrong"})
        self.assertEqual(completed.returncode, 1)
        self.assertIn("sdk/unauthorized", completed.stderr)

    def test_redirects_are_refused_without_follow(self) -> None:
        from scripts.skilit_sdk import SkilitClient as Client

        client = Client(f"http://127.0.0.1:{self.port}", "cli-secret")
        with self.assertRaises(SdkError) as caught:
            client._request("/api/v1/redirect")
        self.assertEqual(caught.exception.code, "sdk/transport")
        self.assertEqual(getattr(self.server, "hits", 0), 1)


if __name__ == "__main__":
    unittest.main()
