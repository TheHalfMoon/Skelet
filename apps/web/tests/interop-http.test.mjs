/**
 * AF-03c agent interoperability via an independent Node fetch MCP client.
 *
 * Client A (this file): Node global fetch speaking JSON-RPC 2.0 over HTTP
 * to a real PGlite-backed interop server (scripts/mcp_test_server.mjs run
 * as a subprocess). No direct dispatchMcp import on the client path: every
 * assertion observes real TCP wire behavior, including protocol-version
 * negotiation headers, bearer auth, envelope request IDs, opaque cursors,
 * typed errors with retryable hints, capability fallbacks, idempotent
 * retries, and cross-client canonical URI recovery (MCP create -> REST
 * SDK read on the same server).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = dirname(require.resolve("../../../package.json"));
const SERVER_SCRIPT = join(repoRoot, "scripts", "mcp_test_server.mjs");

const PROTOCOLS = ["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"];

async function startServer() {
  const proc = spawn(process.execPath, ["--experimental-strip-types", SERVER_SCRIPT], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const info = await new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error("interop server did not start")), 15000);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split("\n")[0];
      if (line && line.trim().length > 0) {
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed && typeof parsed.port === "number") {
            clearTimeout(timer);
            resolve(parsed);
          }
        } catch {
          // Wait for a complete line.
        }
      }
    });
    proc.stderr.on("data", () => {});
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`interop server exited ${code}`));
    });
  });
  return { proc, info };
}

async function stopServer(proc) {
  proc.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    proc.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function mcp(baseUrl, token, body, extraHeaders = {}) {
  const headers = { "content-type": "application/json", ...extraHeaders };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const negotiated = response.headers.get("mcp-protocol-version");
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, json, negotiated };
}

function envelopeOfSuccess(response, context) {
  assert.equal(response.json.jsonrpc, "2.0", `${context}: jsonrpc`);
  assert.ok(response.json.result?.content?.[0]?.text, `${context}: envelope text`);
  const envelope = JSON.parse(response.json.result.content[0].text);
  assert.equal(envelope.schema_version, "skelet.agent.v1", `${context}: schema`);
  assert.ok(typeof envelope.request_id === "string" && envelope.request_id.length > 0, `${context}: request_id`);
  return envelope;
}

function envelopeOfFailure(response, context) {
  assert.ok(response.json.error, `${context}: json-rpc error`);
  assert.ok(response.json.error.data?.envelope, `${context}: failure envelope`);
  return response.json.error.data.envelope;
}

test("AF-03c: protocol versions negotiate with header and param compatibility", async () => {
  const { proc, info } = await startServer();
  try {
    for (const version of PROTOCOLS) {
      const response = await mcp(info.baseUrl, info.ownerToken, {
        jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: version },
      });
      assert.equal(response.json.result.protocolVersion, version, `param ${version}`);
      assert.ok(response.negotiated !== null, "header echoed");
    }
    const unknown = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" },
    });
    assert.equal(unknown.json.result.protocolVersion, PROTOCOLS[0]);
    const missing = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 3, method: "initialize", params: {},
    });
    assert.equal(missing.json.result.protocolVersion, PROTOCOLS[0]);
    const headerOnly = await mcp(
      info.baseUrl,
      info.ownerToken,
      { jsonrpc: "2.0", id: 4, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      { "MCP-Protocol-Version": "2025-03-26" },
    );
    assert.equal(headerOnly.json.result.protocolVersion, "2025-03-26");
    assert.equal(headerOnly.negotiated, "2025-03-26");
    assert.equal(headerOnly.json.result.serverInfo.name, "skelet");
    assert.deepEqual(headerOnly.json.result.skelet.capabilities, { packs: true, registry: true });
  } finally {
    await stopServer(proc);
  }
});

test("AF-03c: authentication binds tokens and denies forged identities", async () => {
  const { proc, info } = await startServer();
  try {
    const missing = await mcp(info.baseUrl, null, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    assert.equal(missing.json.error.code, -32001);
    assert.equal(missing.json.error.data.envelope.error.code, "UNAUTHENTICATED");
    const bogus = await mcp(info.baseUrl, "bogus-token", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    assert.equal(bogus.json.error.code, -32001);
    const allowed = await mcp(info.baseUrl, info.ownerToken, { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
    assert.equal(allowed.json.result.tools.length, 21);
  } finally {
    await stopServer(proc);
  }
});

test("AF-03c: search pagination is deterministic with opaque cursors", async () => {
  const { proc, info } = await startServer();
  try {
    const first = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_assets", arguments: { query: "interop-page", limit: 1 } },
    });
    const firstEnvelope = envelopeOfSuccess(first, "page one");
    assert.equal(firstEnvelope.result.assets.length, 1);
    assert.ok(typeof firstEnvelope.cursor === "string", "cursor present");
    const second = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "search_assets", arguments: { query: "interop-page", limit: 1, cursor: firstEnvelope.cursor } },
    });
    const secondEnvelope = envelopeOfSuccess(second, "page two");
    assert.equal(secondEnvelope.result.assets.length, 1);
    assert.notEqual(secondEnvelope.result.assets[0].uri, firstEnvelope.result.assets[0].uri);
    const badCursor = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_assets", arguments: { query: "interop-page", cursor: "bad" } },
    });
    assert.equal(badCursor.json.error.code, -32602);
    assert.equal(envelopeOfFailure(badCursor, "bad cursor").error.code, "INVALID_INPUT");
    const badLimit = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_assets", arguments: { query: "interop-page", limit: 5000 } },
    });
    assert.equal(badLimit.json.error.code, -32602);
  } finally {
    await stopServer(proc);
  }
});

test("AF-03c: request IDs correlate retries and typed errors carry retry hints", async () => {
  const { proc, info } = await startServer();
  try {
    const echoed = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "search_assets", arguments: { query: "interop-page", requestId: "req-interop-001" } },
    });
    assert.equal(envelopeOfSuccess(echoed, "echoed").request_id, "req-interop-001");
    const malformed = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "search_assets", arguments: { query: "interop-page", requestId: "" } },
    });
    assert.equal(malformed.json.error.code, -32602);
    const invalid = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_assets", arguments: {} },
    });
    const invalidEnvelope = envelopeOfFailure(invalid, "invalid");
    assert.equal(invalidEnvelope.error.code, "INVALID_INPUT");
    assert.equal(invalidEnvelope.error.retryable, false);
    const denied = await mcp(info.baseUrl, info.outsiderToken, {
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "get_object", arguments: { uri: `skelet://artifact/${info.privateId}` } },
    });
    assert.equal(envelopeOfFailure(denied, "denied").error.retryable, false);
  } finally {
    await stopServer(proc);
  }
});

test("AF-03c: write retries with the same idempotency key return one pack", async () => {
  const { proc, info } = await startServer();
  try {
    const key = `interop-${Date.now()}-a`;
    const first = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: {
        name: "create_reference_pack",
        arguments: { workspaceId: info.workspaceId, title: "Interop pack", artifactIds: [info.artifactId], idempotencyKey: key },
      },
    });
    const firstUri = envelopeOfSuccess(first, "first pack").result.pack.uri;
    const second = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: {
        name: "create_reference_pack",
        arguments: { workspaceId: info.workspaceId, title: "Interop pack retry-title", artifactIds: [info.artifactId], idempotencyKey: key },
      },
    });
    assert.equal(envelopeOfSuccess(second, "retry pack").result.pack.uri, firstUri);
    const third = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: {
        name: "create_reference_pack",
        arguments: { workspaceId: info.workspaceId, title: "Interop pack other", artifactIds: [info.artifactId], idempotencyKey: `${key}-other` },
      },
    });
    assert.notEqual(envelopeOfSuccess(third, "other key").result.pack.uri, firstUri);
    const badKey = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: {
        name: "create_reference_pack",
        arguments: { workspaceId: info.workspaceId, title: "Bad", idempotencyKey: "has space" },
      },
    });
    assert.equal(badKey.json.error.code, -32602);
    // save_reference retries stay idempotent without a ledger.
    const packUri = firstUri;
    const collectionId = packUri.split("/").pop();
    for (const id of [5, 6]) {
      const saved = await mcp(info.baseUrl, info.ownerToken, {
        jsonrpc: "2.0", id, method: "tools/call",
        params: { name: "save_reference", arguments: { collectionId, artifactId: info.artifactId, idempotencyKey: key } },
      });
      assert.equal(envelopeOfSuccess(saved, "save retry").result.saved, true);
    }
  } finally {
    await stopServer(proc);
  }
});

test("AF-03c: capability advertisement and unsupported-extension fallbacks", async () => {
  const { proc, info } = await startServer();
  try {
    const init = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2026-07-28" },
    });
    assert.deepEqual(init.json.result.skelet.capabilities, { packs: true, registry: true });
    const resources = await mcp(info.baseUrl, info.ownerToken, { jsonrpc: "2.0", id: 2, method: "resources/list", params: {} });
    assert.equal(resources.json.error.code, -32601);
    const prompts = await mcp(info.baseUrl, info.ownerToken, { jsonrpc: "2.0", id: 3, method: "prompts/list", params: {} });
    assert.equal(prompts.json.error.code, -32601);
    const tasks = await mcp(info.baseUrl, info.ownerToken, { jsonrpc: "2.0", id: 4, method: "tasks/get", params: {} });
    assert.equal(tasks.json.error.code, -32601);
    // REST fallback stays available when an MCP extension is unsupported:
    // the same canonical URI resolves over REST with the same envelope.
    const created = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 5, method: "tools/call",
      params: { name: "get_object", arguments: { uri: `skelet://artifact/${info.artifactId}` } },
    });
    const uri = envelopeOfSuccess(created, "mcp object").result.object.uri;
    const rest = await fetch(`${info.baseUrl}/api/v1/objects?uri=${encodeURIComponent(uri)}`, {
      headers: { authorization: `Bearer ${info.ownerToken}` },
    });
    assert.equal(rest.status, 200);
    const restBody = await rest.json();
    assert.equal(restBody.schema_version, "skelet.agent.v1");
    assert.equal(restBody.result.object.uri, uri);
  } finally {
    await stopServer(proc);
  }
});

test("AF-03c: cross-workspace and rights denials share no oracle", async () => {
  const { proc, info } = await startServer();
  try {
    const denied = await mcp(info.baseUrl, info.outsiderToken, {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "get_object", arguments: { uri: `skelet://artifact/${info.privateId}` } },
    });
    const missing = await mcp(info.baseUrl, info.outsiderToken, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "get_object", arguments: { uri: "skelet://artifact/11111111-2222-4333-8444-555555555555" } },
    });
    assert.equal(denied.json.error.code, -32000);
    assert.equal(missing.json.error.code, -32000);
    assert.equal(envelopeOfFailure(denied, "denied").error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(envelopeOfFailure(missing, "missing").error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(envelopeOfFailure(denied, "denied").error.message, envelopeOfFailure(missing, "missing").error.message);
    const rights = await mcp(info.baseUrl, info.memberToken, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "get_object", arguments: { uri: `skelet://artifact/${info.restrictedId}` } },
    });
    assert.equal(envelopeOfFailure(rights, "rights").error.code, "RIGHTS_RESTRICTED");
  } finally {
    await stopServer(proc);
  }
});

test("AF-03c: cross-client canonical URI handoff (MCP create, SDK read)", async () => {
  const { proc, info } = await startServer();
  try {
    const { SkeletClient } = await import("../../../packages/sdk-ts/src/client.ts");
    const created = await mcp(info.baseUrl, info.ownerToken, {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: {
        name: "create_reference_pack",
        arguments: { workspaceId: info.workspaceId, title: "Handoff pack", artifactIds: [info.artifactId] },
      },
    });
    const packUri = envelopeOfSuccess(created, "handoff create").result.pack.uri;
    assert.match(packUri, /^skelet:\/\/collection\//);
    const sdk = new SkeletClient({ baseUrl: info.baseUrl, token: info.ownerToken });
    const pack = await sdk.getObject(packUri);
    assert.equal(pack.uri, packUri);
    assert.equal(pack.itemCount, 1);
    assert.equal(pack.items[0].uri, `skelet://artifact/${info.artifactId}`);
    const page = await sdk.searchAssetsPage({ query: "interop-page", limit: 1 });
    assert.equal(page.items.length, 1);
    assert.ok(typeof page.cursor === "string");
    assert.ok(typeof page.requestId === "string" && page.requestId.length > 0);
    const second = await sdk.searchAssetsPage({ query: "interop-page", limit: 1, cursor: page.cursor });
    assert.notEqual(second.items[0].uri, page.items[0].uri);
  } finally {
    await stopServer(proc);
  }
});
