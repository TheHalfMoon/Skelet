import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createSource } from "../../../packages/db/src/repositories.ts";
import { registerAsset } from "../../../packages/assets/src/registry.ts";
import { bearerToken, dispatchMcp } from "../lib/mcp.ts";
import { resetRateLimits, checkRateLimit } from "../lib/rate-limit.ts";

const TOKENS = ["test-token"];
const CTX = { tokens: TOKENS, token: "test-token" };
const ANON = { tokens: TOKENS, token: null };

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const source = await createSource(db, { key: "mcp-source", kind: "synthetic" });
  const icon = await registerAsset(db, {
    kind: "icon",
    title: "MCP arrow",
    sourceId: source.id,
    contentHash: "9".repeat(64),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "arrow", tags: ["arrow"], license: "MIT" },
    asset: { sha256: "9".repeat(64), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/mc/arrow" },
  });
  return { db, icon };
}

async function call(db, ctx, method, params, id = 1) {
  return dispatchMcp(db, ctx, { jsonrpc: "2.0", id, method, params });
}

test("initialize negotiates protocol versions", async () => {
  const fx = await fixture();
  try {
    const latest = await call(fx.db, ANON, "initialize", { protocolVersion: "2026-07-28" });
    assert.equal(latest.result.protocolVersion, "2026-07-28");
    assert.equal(latest.result.serverInfo.name, "skelet");
    assert.deepEqual(Object.keys(latest.result.capabilities), ["tools"]);
    const legacy = await call(fx.db, ANON, "initialize", { protocolVersion: "2024-11-05" });
    assert.equal(legacy.result.protocolVersion, "2024-11-05");
    const unknown = await call(fx.db, ANON, "initialize", { protocolVersion: "1999-01-01" });
    assert.equal(unknown.result.protocolVersion, "2026-07-28");
    const ping = await call(fx.db, ANON, "ping", {});
    assert.deepEqual(ping.result, {});
  } finally {
    await fx.db.close();
  }
});

test("tools require bearer authorization", async () => {
  const fx = await fixture();
  try {
    const denied = await call(fx.db, ANON, "tools/list", {});
    assert.equal(denied.error.code, -32001);
    assert.equal(denied.id, 1);
    const wrong = await call(fx.db, { tokens: TOKENS, token: "wrong" }, "tools/list", {});
    assert.equal(wrong.error.code, -32001);
    const empty = await call(fx.db, { tokens: [], token: "test-token" }, "tools/list", {});
    assert.equal(empty.error.code, -32001);
    const allowed = await call(fx.db, CTX, "tools/list", {});
    assert.equal(allowed.result.tools.length, 3);
    assert.deepEqual(
      allowed.result.tools.map((tool) => tool.name).sort(),
      ["get_asset", "get_registry_item", "search_assets"],
    );
  } finally {
    await fx.db.close();
  }
});

test("asset tools return stable Skelet URIs", async () => {
  const fx = await fixture();
  try {
    const searched = await call(fx.db, CTX, "tools/call", {
      name: "search_assets",
      arguments: { query: "arrow" },
    });
    const payload = JSON.parse(searched.result.content[0].text);
    assert.equal(payload.assets.length, 1);
    assert.equal(payload.assets[0].uri, `skelet://artifact/${fx.icon.artifactId}`);
    assert.equal(payload.assets[0].serving, "download");
    const single = await call(fx.db, CTX, "tools/call", {
      name: "get_asset",
      arguments: { artifactId: fx.icon.artifactId },
    });
    const one = JSON.parse(single.result.content[0].text);
    assert.equal(one.asset.uri, `skelet://artifact/${fx.icon.artifactId}`);
    const item = await call(fx.db, CTX, "tools/call", {
      name: "get_registry_item",
      arguments: { name: "skelet-button" },
    });
    assert.equal(JSON.parse(item.result.content[0].text).item.name, "skelet-button");
  } finally {
    await fx.db.close();
  }
});

test("unknown methods, tools, and malformed bodies fail closed", async () => {
  const fx = await fixture();
  try {
    const method = await call(fx.db, CTX, "frobnicate", {});
    assert.equal(method.error.code, -32601);
    const tool = await call(fx.db, CTX, "tools/call", { name: "delete_everything", arguments: {} });
    assert.equal(tool.error.code, -32601);
    const params = await call(fx.db, CTX, "tools/call", { name: "search_assets", arguments: {} });
    assert.equal(params.error.code, -32602);
    const missing = await call(fx.db, CTX, "tools/call", {
      name: "get_asset",
      arguments: { artifactId: "00000000-0000-0000-0000-000000000000" },
    });
    assert.equal(missing.error.code, -32000);
    const garbage = await dispatchMcp(fx.db, CTX, { nope: true });
    assert.equal(garbage.error.code, -32600);
    const batch = await dispatchMcp(fx.db, CTX, [
      { jsonrpc: "2.0", id: 1, method: "ping", params: {} },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { nope: true },
    ]);
    assert.equal(batch.length, 2);
    assert.deepEqual(batch[0].result, {});
    assert.equal(batch[1].error.code, -32600);
    const empty = await dispatchMcp(fx.db, CTX, []);
    assert.equal(empty.error.code, -32600);
  } finally {
    await fx.db.close();
  }
});

test("bearer token parsing is strict", () => {
  assert.equal(bearerToken(null), null);
  assert.equal(bearerToken("Token abc"), null);
  assert.equal(bearerToken("Bearer "), null);
  assert.equal(bearerToken("Bearer test-token"), "test-token");
  assert.equal(bearerToken("  Bearer test-token  "), "test-token");
  assert.equal(bearerToken("bearer spaced-token"), "spaced-token");
});

test("envelope edge cases stay protocol-clean", async () => {
  const fx = await fixture();
  try {
    const notificationOnly = await dispatchMcp(fx.db, CTX, [
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    assert.equal(notificationOnly, null);
    const idLess = await dispatchMcp(fx.db, CTX, { jsonrpc: "2.0", method: "ping" });
    assert.equal(idLess, null);
    const badKinds = await call(fx.db, CTX, "tools/call", {
      name: "search_assets",
      arguments: { query: "arrow", kinds: ["spaceship"] },
    });
    assert.equal(badKinds.error.code, -32602);
    const badLimit = await call(fx.db, CTX, "tools/call", {
      name: "search_assets",
      arguments: { query: "arrow", limit: 5000 },
    });
    assert.equal(badLimit.error.code, -32602);
    const oversized = await dispatchMcp(fx.db, CTX, new Array(33).fill({ jsonrpc: "2.0", id: 1, method: "ping" }));
    assert.equal(oversized.error.code, -32600);
  } finally {
    await fx.db.close();
  }
});

test("rate limiter fails closed at the window edge", () => {
  resetRateLimits();
  const at = 1_700_000_000_000;
  for (let index = 0; index < 120; index += 1) {
    assert.equal(checkRateLimit("client", at + index).allowed, true);
  }
  const denied = checkRateLimit("client", at + 120);
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterSeconds >= 1);
  assert.equal(checkRateLimit("other", at + 120).allowed, true);
  resetRateLimits();
});
