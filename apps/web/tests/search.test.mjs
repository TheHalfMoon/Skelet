import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createSource } from "../../../packages/db/src/repositories.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { registerAsset } from "../../../packages/assets/src/registry.ts";
import { searchAssetsRoute } from "../lib/rest.ts";
import { dispatchMcp } from "../lib/mcp.ts";

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "af04-rest@example.com", password: "af04-password-01" });
  const source = await createSource(db, { key: "af04-rest-source", kind: "synthetic" });
  await registerAsset(db, {
    kind: "icon",
    title: "AF04 REST arrow",
    sourceId: source.id,
    contentHash: "c".repeat(64),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "af04-rest-arrow", tags: ["af04rest"], license: "MIT" },
    asset: { sha256: "c".repeat(64), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/af04/rest" },
  });
  await registerAsset(db, {
    kind: "logo",
    title: "AF04 REST brand",
    sourceId: source.id,
    contentHash: "d".repeat(64),
    rightsClassification: "restricted",
    metadata: { collection: "brand-corpus", ref: "af04-rest-brand", tags: ["af04rest"], license: "proprietary", trademark: true },
  });
  return { db, owner };
}

async function mcpCall(db, ctx, name, args) {
  const response = await dispatchMcp(db, ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  if (response.error) return { error: response.error };
  return JSON.parse(response.result.content[0].text);
}

test("AF-04 REST search exposes mode, facets, filters, and pagination", async () => {
  const fx = await fixture();
  try {
    const ok = await searchAssetsRoute(fx.db, { query: "af04rest" }, fx.owner.id);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.schema_version, "skilit.agent.v1");
    assert.ok(["postgres-fts", "literal-like"].includes(ok.body.result.search_mode));
    assert.equal(ok.body.result.assets.length, 2);

    const facets = await searchAssetsRoute(fx.db, { query: "af04rest", facets: "true" }, fx.owner.id);
    assert.equal(facets.status, 200);
    assert.ok(facets.body.result.facets !== undefined);
    assert.ok(Array.isArray(facets.body.result.facets.kinds));

    const icons = await searchAssetsRoute(fx.db, { query: "af04rest", kinds: "icon" }, fx.owner.id);
    assert.equal(icons.status, 200);
    assert.ok(icons.body.result.assets.every((entry) => entry.kind === "icon"));

    const restricted = await searchAssetsRoute(fx.db, { query: "af04rest", rights: "restricted" }, fx.owner.id);
    assert.equal(restricted.status, 200);
    assert.equal(restricted.body.result.assets.length, 1);

    const free = await searchAssetsRoute(fx.db, { query: "af04rest", trademarkFree: "true" }, fx.owner.id);
    assert.equal(free.status, 200);
    assert.ok(free.body.result.assets.every((entry) => entry.kind === "icon"));

    const pageOne = await searchAssetsRoute(fx.db, { query: "af04rest", limit: "1" }, fx.owner.id);
    assert.equal(pageOne.status, 200);
    assert.equal(pageOne.body.result.assets.length, 1);
    assert.ok(typeof pageOne.body.cursor === "string");
    const pageTwo = await searchAssetsRoute(fx.db, { query: "af04rest", limit: "1", cursor: pageOne.body.cursor }, fx.owner.id);
    assert.equal(pageTwo.status, 200);
    assert.equal(pageTwo.body.result.assets.length, 1);
    assert.notEqual(pageOne.body.result.assets[0].uri, pageTwo.body.result.assets[0].uri);

    // Invalid inputs stay INVALID_INPUT with no internals.
    assert.equal((await searchAssetsRoute(fx.db, { query: "af04rest", kinds: "spaceship" }, fx.owner.id)).status, 400);
    assert.equal((await searchAssetsRoute(fx.db, { query: "af04rest", kinds: "icon,icon" }, fx.owner.id)).status, 400);
    assert.equal((await searchAssetsRoute(fx.db, { query: "af04rest", rights: "classified" }, fx.owner.id)).status, 400);
    assert.equal((await searchAssetsRoute(fx.db, { query: "af04rest", trademarkFree: "yes" }, fx.owner.id)).status, 400);
    assert.equal((await searchAssetsRoute(fx.db, { query: "af04rest", facets: "yes" }, fx.owner.id)).status, 400);
    assert.equal((await searchAssetsRoute(fx.db, { query: "af04rest", cursor: "!!!bad!!!" }, fx.owner.id)).status, 400);
    assert.equal((await searchAssetsRoute(fx.db, { query: "%" }, fx.owner.id)).status, 200);
  } finally {
    await fx.db.close();
  }
});

test("AF-04 MCP search_assets exposes mode, facets, filters, and errors", async () => {
  const fx = await fixture();
  const ctx = { userId: fx.owner.id };
  try {
    const ok = await mcpCall(fx.db, ctx, "search_assets", { query: "af04rest" });
    assert.equal(ok.schema_version, "skilit.agent.v1");
    assert.ok(["postgres-fts", "literal-like"].includes(ok.result.search_mode));
    assert.equal(ok.result.assets.length, 2);

    const facets = await mcpCall(fx.db, ctx, "search_assets", { query: "af04rest", facets: true });
    assert.ok(facets.result.facets !== undefined);

    const icons = await mcpCall(fx.db, ctx, "search_assets", { query: "af04rest", kinds: ["icon"] });
    assert.ok(icons.result.assets.every((entry) => entry.kind === "icon"));

    const badKinds = await mcpCall(fx.db, ctx, "search_assets", { query: "af04rest", kinds: ["spaceship"] });
    assert.equal(badKinds.error.code, -32602);
    assert.equal(badKinds.error.data.envelope.error.code, "INVALID_INPUT");
    const dupKinds = await mcpCall(fx.db, ctx, "search_assets", { query: "af04rest", kinds: ["icon", "icon"] });
    assert.equal(dupKinds.error.code, -32602);
    const badRights = await mcpCall(fx.db, ctx, "search_assets", { query: "af04rest", rights: ["classified"] });
    assert.equal(badRights.error.code, -32602);
    const badLicenses = await mcpCall(fx.db, ctx, "search_assets", { query: "af04rest", licenses: [""] });
    assert.equal(badLicenses.error.code, -32602);
    const badTrademark = await mcpCall(fx.db, ctx, "search_assets", { query: "af04rest", trademarkFree: "yes" });
    assert.equal(badTrademark.error.code, -32602);
    const badFacets = await mcpCall(fx.db, ctx, "search_assets", { query: "af04rest", facets: "yes" });
    assert.equal(badFacets.error.code, -32602);
    const badCursor = await mcpCall(fx.db, ctx, "search_assets", { query: "af04rest", cursor: "!!!bad!!!" });
    assert.equal(badCursor.error.code, -32602);

    const first = await mcpCall(fx.db, ctx, "search_assets", { query: "af04rest", limit: 1 });
    assert.equal(first.result.assets.length, 1);
    assert.ok(typeof first.cursor === "string");
    const second = await mcpCall(fx.db, ctx, "search_assets", { query: "af04rest", limit: 1, cursor: first.cursor });
    assert.equal(second.result.assets.length, 1);
    assert.notEqual(first.result.assets[0].uri, second.result.assets[0].uri);
  } finally {
    await fx.db.close();
  }
});
