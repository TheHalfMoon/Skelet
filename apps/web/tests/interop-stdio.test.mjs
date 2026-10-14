/**
 * AF-03c agent interoperability via an independent stdio MCP client.
 *
 * Client C (this file): Node child_process speaking line-delimited JSON-RPC
 * 2.0 over stdin/stdout pipes to scripts/mcp_stdio.mjs (a separate OS
 * process with its own PGlite fixture). No HTTP, no fetch, no shared
 * in-process dispatch: the transport, framing, and process boundary are all
 * distinct from the HTTP fetch and Python urllib clients, while the
 * canonical envelopes, URIs, cursors, request IDs, idempotency keys,
 * capabilities, and denials stay identical.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import readline from "node:readline";

const require = createRequire(import.meta.url);
const repoRoot = dirname(require.resolve("../../../package.json"));
const STDIO_SCRIPT = join(repoRoot, "scripts", "mcp_stdio.mjs");

async function startBridge() {
  const proc = spawn(process.execPath, ["--experimental-strip-types", STDIO_SCRIPT], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  const info = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stdio bridge did not start")), 15000);
    rl.once("line", (line) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`stdio bridge exited ${code}`));
    });
  });
  let nextId = 100;
  async function call(body) {
    const id = body.id ?? nextId++;
    const request = { ...body, id };
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("stdio response timeout")), 15000);
      const onLine = (line) => {
        try {
          const parsed = JSON.parse(line);
          if (parsed && parsed.id === id) {
            clearTimeout(timer);
            resolve(parsed);
          } else {
            rl.once("line", onLine);
          }
        } catch {
          rl.once("line", onLine);
        }
      };
      rl.once("line", onLine);
      proc.stdin.write(`${JSON.stringify(request)}\n`);
    });
    return response;
  }
  async function stop() {
    try {
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 999999, method: "__shutdown__" })}\n`);
    } catch {
      // Bridge may already be closing.
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      proc.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    rl.close();
  }
  return { proc, info, call, stop };
}

function successEnvelope(response, context) {
  assert.equal(response.jsonrpc, "2.0", `${context}: jsonrpc`);
  assert.ok(response.result?.content?.[0]?.text, `${context}: envelope text`);
  const envelope = JSON.parse(response.result.content[0].text);
  assert.equal(envelope.schema_version, "skelet.agent.v1", `${context}: schema`);
  assert.ok(typeof envelope.request_id === "string" && envelope.request_id.length > 0, `${context}: request_id`);
  return envelope;
}

function failureEnvelope(response, context) {
  assert.ok(response.error, `${context}: json-rpc error`);
  assert.ok(response.error.data?.envelope, `${context}: failure envelope`);
  return response.error.data.envelope;
}

test("AF-03c stdio: versions, tools, and search pagination match HTTP semantics", async () => {
  const bridge = await startBridge();
  try {
    for (const version of ["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"]) {
      const init = await bridge.call({ jsonrpc: "2.0", method: "initialize", params: { protocolVersion: version } });
      assert.equal(init.result.protocolVersion, version);
    }
    const unknown = await bridge.call({ jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "1999-01-01" } });
    assert.equal(unknown.result.protocolVersion, "2026-07-28");
    assert.deepEqual(unknown.result.skelet.capabilities, { packs: true, registry: true });
    const list = await bridge.call({ jsonrpc: "2.0", method: "tools/list", params: {} });
    assert.equal(list.result.tools.length, 18);
    const first = await bridge.call({
      jsonrpc: "2.0", method: "tools/call",
      params: { name: "search_assets", arguments: { query: "stdio-page", limit: 1 } },
    });
    const firstEnvelope = successEnvelope(first, "stdio page one");
    assert.equal(firstEnvelope.result.assets.length, 1);
    assert.ok(typeof firstEnvelope.cursor === "string");
    const second = await bridge.call({
      jsonrpc: "2.0", method: "tools/call",
      params: { name: "search_assets", arguments: { query: "stdio-page", limit: 1, cursor: firstEnvelope.cursor } },
    });
    assert.notEqual(successEnvelope(second, "stdio page two").result.assets[0].uri, firstEnvelope.result.assets[0].uri);
    const bad = await bridge.call({
      jsonrpc: "2.0", method: "tools/call",
      params: { name: "search_assets", arguments: { query: "stdio-page", cursor: "bad" } },
    });
    assert.equal(bad.error.code, -32602);
    assert.equal(failureEnvelope(bad, "stdio bad cursor").error.code, "INVALID_INPUT");
  } finally {
    await bridge.stop();
  }
});

test("AF-03c stdio: request IDs, idempotency, and unsupported fallbacks", async () => {
  const bridge = await startBridge();
  try {
    const echoed = await bridge.call({
      jsonrpc: "2.0", method: "tools/call",
      params: { name: "search_assets", arguments: { query: "stdio-page", requestId: "req-stdio-001" } },
    });
    assert.equal(successEnvelope(echoed, "stdio echo").request_id, "req-stdio-001");
    const key = `stdio-${Date.now()}-a`;
    const first = await bridge.call({
      jsonrpc: "2.0", method: "tools/call",
      params: {
        name: "create_reference_pack",
        arguments: { workspaceId: bridge.info.workspaceId, title: "Stdio pack", artifactIds: [bridge.info.artifactId], idempotencyKey: key },
      },
    });
    const firstUri = successEnvelope(first, "stdio first").result.pack.uri;
    const second = await bridge.call({
      jsonrpc: "2.0", method: "tools/call",
      params: {
        name: "create_reference_pack",
        arguments: { workspaceId: bridge.info.workspaceId, title: "Stdio retry", artifactIds: [bridge.info.artifactId], idempotencyKey: key },
      },
    });
    assert.equal(successEnvelope(second, "stdio retry").result.pack.uri, firstUri);
    const resources = await bridge.call({ jsonrpc: "2.0", method: "resources/list", params: {} });
    assert.equal(resources.error.code, -32601);
    const tasks = await bridge.call({ jsonrpc: "2.0", method: "tasks/get", params: {} });
    assert.equal(tasks.error.code, -32601);
  } finally {
    await bridge.stop();
  }
});

test("AF-03c stdio: actor gate denies outsider private without oracle", async () => {
  const bridge = await startBridge();
  try {
    const own = await bridge.call({
      jsonrpc: "2.0", method: "tools/call",
      params: { name: "get_object", arguments: { uri: `skelet://artifact/${bridge.info.privateId}` } },
    });
    assert.equal(successEnvelope(own, "stdio own private").result.object.title, "Stdio private screen");
    const denied = await bridge.call({
      jsonrpc: "2.0", method: "tools/call",
      params: { name: "get_object", arguments: { uri: `skelet://artifact/${bridge.info.outsiderPrivateId}` } },
    });
    const missing = await bridge.call({
      jsonrpc: "2.0", method: "tools/call",
      params: { name: "get_object", arguments: { uri: "skelet://artifact/11111111-2222-4333-8444-555555555555" } },
    });
    assert.equal(denied.error.code, -32000);
    assert.equal(missing.error.code, -32000);
    assert.equal(failureEnvelope(denied, "stdio denied").error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(failureEnvelope(missing, "stdio missing").error.code, "FORBIDDEN_OR_NOT_FOUND");
    const rights = await bridge.call({
      jsonrpc: "2.0", method: "tools/call",
      params: { name: "get_object", arguments: { uri: `skelet://artifact/${bridge.info.restrictedId}` } },
    });
    // The stdio owner passes the actor gate, so restricted surfaces as
    // RIGHTS_RESTRICTED (the same post-gate ordering as HTTP).
    assert.equal(failureEnvelope(rights, "stdio rights").error.code, "RIGHTS_RESTRICTED");
    // Cross-client recovery on this transport: the pack URI created here
    // resolves back to the same canonical artifact URI.
    const pack = await bridge.call({
      jsonrpc: "2.0", method: "tools/call",
      params: {
        name: "create_reference_pack",
        arguments: { workspaceId: bridge.info.workspaceId, title: "Stdio handoff", artifactIds: [bridge.info.artifactId] },
      },
    });
    const packUri = successEnvelope(pack, "stdio handoff").result.pack.uri;
    const fetched = await bridge.call({
      jsonrpc: "2.0", method: "tools/call",
      params: { name: "get_object", arguments: { uri: packUri } },
    });
    assert.equal(successEnvelope(fetched, "stdio pack fetch").result.pack.items[0].uri, `skelet://artifact/${bridge.info.artifactId}`);
  } finally {
    await bridge.stop();
  }
});
