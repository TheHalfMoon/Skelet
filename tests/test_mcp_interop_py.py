"""AF-03c agent interoperability via an independent Python urllib MCP client.

Client B (this file): Python standard library only (urllib + json, no shared
JavaScript code) speaking JSON-RPC 2.0 over HTTP to the same real
PGlite-backed interop server as the Node fetch client. Every assertion
observes real TCP wire behavior against one canonical implementation, so
passing here plus the Node HTTP file plus the stdio file proves three
genuinely independent client stacks share protocol versions, auth,
envelopes, pagination, request IDs, idempotency, capabilities, denials,
and canonical URI recovery.
"""

from __future__ import annotations

import json
import subprocess
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER_SCRIPT = ROOT / "scripts" / "mcp_test_server.mjs"
PROTOCOLS = ["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"]


def start_server():
    proc = subprocess.Popen(
        ["node", "--experimental-strip-types", str(SERVER_SCRIPT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    line = proc.stdout.readline()
    deadline = time.time() + 15
    while not line.strip():
        if time.time() > deadline:
            proc.kill()
            raise RuntimeError("interop server did not start")
        line = proc.stdout.readline()
    info = json.loads(line.strip())
    return proc, info


def stop_server(proc):
    try:
        proc.terminate()
        proc.wait(timeout=5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    finally:
        try:
            if proc.stdout:
                proc.stdout.close()
        except Exception:
            pass
        try:
            if proc.stderr:
                proc.stderr.close()
        except Exception:
            pass


def mcp(base_url, token, body, extra_headers=None):
    url = base_url + "/mcp"
    data = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read().decode("utf-8")
            negotiated = response.headers.get("MCP-Protocol-Version")
            return response.status, json.loads(raw) if raw else None, negotiated
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8")
        try:
            payload = json.loads(raw) if raw else None
        except ValueError:
            payload = None
        return error.code, payload, error.headers.get("MCP-Protocol-Version")


def success_envelope(response, context):
    _status, payload, _negotiated = response
    assert payload.get("jsonrpc") == "2.0", context
    text = payload["result"]["content"][0]["text"]
    envelope = json.loads(text)
    assert envelope["schema_version"] == "skilit.agent.v1", context
    assert isinstance(envelope.get("request_id"), str) and envelope["request_id"], context
    return envelope


def failure_envelope(response, context):
    _status, payload, _negotiated = response
    assert "error" in payload, context
    assert "envelope" in payload["error"].get("data", {}), context
    return payload["error"]["data"]["envelope"]


class McpInteropPythonTests(unittest.TestCase):
    def test_protocol_versions_negotiate(self) -> None:
        proc, info = start_server()
        try:
            for version in PROTOCOLS:
                _status, payload, _neg = mcp(
                    info["baseUrl"], info["ownerToken"],
                    {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": version}},
                )
                self.assertEqual(payload["result"]["protocolVersion"], version)
            _status, payload, _neg = mcp(
                info["baseUrl"], info["ownerToken"],
                {"jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {"protocolVersion": "1999-01-01"}},
            )
            self.assertEqual(payload["result"]["protocolVersion"], PROTOCOLS[0])
            _status, payload, negotiated = mcp(
                info["baseUrl"], info["ownerToken"],
                {"jsonrpc": "2.0", "id": 3, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}},
                extra_headers={"MCP-Protocol-Version": "2025-03-26"},
            )
            self.assertEqual(payload["result"]["protocolVersion"], "2025-03-26")
            self.assertEqual(negotiated, "2025-03-26")
            self.assertEqual(payload["result"]["skilit"]["capabilities"], {"packs": True, "registry": True})
        finally:
            stop_server(proc)

    def test_auth_and_pagination(self) -> None:
        proc, info = start_server()
        try:
            _status, payload, _neg = mcp(
                info["baseUrl"], None,
                {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
            )
            self.assertEqual(payload["error"]["code"], -32001)
            self.assertEqual(payload["error"]["data"]["envelope"]["error"]["code"], "UNAUTHENTICATED")
            first = mcp(
                info["baseUrl"], info["ownerToken"],
                {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                 "params": {"name": "search_assets", "arguments": {"query": "interop-page", "limit": 1}}},
            )
            first_env = success_envelope(first, "page one")
            self.assertEqual(len(first_env["result"]["assets"]), 1)
            self.assertIsInstance(first_env.get("cursor"), str)
            second = mcp(
                info["baseUrl"], info["ownerToken"],
                {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                 "params": {"name": "search_assets",
                            "arguments": {"query": "interop-page", "limit": 1, "cursor": first_env["cursor"]}}},
            )
            second_env = success_envelope(second, "page two")
            self.assertNotEqual(second_env["result"]["assets"][0]["uri"], first_env["result"]["assets"][0]["uri"])
            bad = mcp(
                info["baseUrl"], info["ownerToken"],
                {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                 "params": {"name": "search_assets", "arguments": {"query": "interop-page", "cursor": "bad"}}},
            )
            self.assertEqual(bad[1]["error"]["code"], -32602)
            self.assertEqual(failure_envelope(bad, "bad cursor")["error"]["code"], "INVALID_INPUT")
        finally:
            stop_server(proc)

    def test_request_ids_idempotency_and_denials(self) -> None:
        proc, info = start_server()
        try:
            echoed = mcp(
                info["baseUrl"], info["ownerToken"],
                {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                 "params": {"name": "search_assets",
                            "arguments": {"query": "interop-page", "requestId": "req-py-001"}}},
            )
            self.assertEqual(success_envelope(echoed, "echoed")["request_id"], "req-py-001")
            key = f"py-{int(time.time() * 1000)}-a"
            first = mcp(
                info["baseUrl"], info["ownerToken"],
                {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                 "params": {"name": "create_reference_pack",
                            "arguments": {"workspaceId": info["workspaceId"], "title": "Py pack",
                                          "artifactIds": [info["artifactId"]], "idempotencyKey": key}}},
            )
            first_uri = success_envelope(first, "first")["result"]["pack"]["uri"]
            second = mcp(
                info["baseUrl"], info["ownerToken"],
                {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                 "params": {"name": "create_reference_pack",
                            "arguments": {"workspaceId": info["workspaceId"], "title": "Py retry",
                                          "artifactIds": [info["artifactId"]], "idempotencyKey": key}}},
            )
            self.assertEqual(success_envelope(second, "retry")["result"]["pack"]["uri"], first_uri)
            denied = mcp(
                info["baseUrl"], info["outsiderToken"],
                {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                 "params": {"name": "get_object",
                            "arguments": {"uri": f"skilit://artifact/{info['privateId']}"}}},
            )
            missing = mcp(
                info["baseUrl"], info["outsiderToken"],
                {"jsonrpc": "2.0", "id": 5, "method": "tools/call",
                 "params": {"name": "get_object",
                            "arguments": {"uri": "skilit://artifact/11111111-2222-4333-8444-555555555555"}}},
            )
            self.assertEqual(failure_envelope(denied, "denied")["error"]["code"], "FORBIDDEN_OR_NOT_FOUND")
            self.assertEqual(failure_envelope(missing, "missing")["error"]["code"], "FORBIDDEN_OR_NOT_FOUND")
            self.assertEqual(
                failure_envelope(denied, "denied")["error"]["message"],
                failure_envelope(missing, "missing")["error"]["message"],
            )
            rights = mcp(
                info["baseUrl"], info["memberToken"],
                {"jsonrpc": "2.0", "id": 6, "method": "tools/call",
                 "params": {"name": "get_object",
                            "arguments": {"uri": f"skilit://artifact/{info['restrictedId']}"}}},
            )
            self.assertEqual(failure_envelope(rights, "rights")["error"]["code"], "RIGHTS_RESTRICTED")
            # Unsupported extensions fall back without breaking the session.
            _status, payload, _neg = mcp(
                info["baseUrl"], info["ownerToken"],
                {"jsonrpc": "2.0", "id": 7, "method": "resources/list", "params": {}},
            )
            self.assertEqual(payload["error"]["code"], -32601)
        finally:
            stop_server(proc)

    def test_cross_client_uri_handoff_to_rest(self) -> None:
        proc, info = start_server()
        try:
            created = mcp(
                info["baseUrl"], info["ownerToken"],
                {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                 "params": {"name": "get_object",
                            "arguments": {"uri": f"skilit://artifact/{info['artifactId']}"}}},
            )
            uri = success_envelope(created, "mcp object")["result"]["object"]["uri"]
            self.assertTrue(uri.startswith("skilit://artifact/"))
            # Same canonical URI over REST with the Python SDK shape.
            url = info["baseUrl"] + "/api/v1/objects?" + urllib.parse.urlencode({"uri": uri})
            request = urllib.request.Request(url, headers={"Authorization": f"Bearer {info['ownerToken']}"})
            with urllib.request.urlopen(request, timeout=15) as response:
                body = json.loads(response.read().decode("utf-8"))
                self.assertEqual(response.status, 200)
                self.assertEqual(body["schema_version"], "skilit.agent.v1")
                self.assertEqual(body["result"]["object"]["uri"], uri)
                self.assertIsInstance(body.get("request_id"), str)
        finally:
            stop_server(proc)


if __name__ == "__main__":
    unittest.main()
