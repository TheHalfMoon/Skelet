import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createProduct, createProductVersion, createSource } from "../../../packages/db/src/repositories.ts";
import { createArtifact } from "../../../packages/db/src/graph.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { dispatchMcp } from "../lib/mcp.ts";
import { listProductsRoute, listProductVersionsRoute } from "../lib/rest.ts";
import { AGENT_SCHEMA_VERSION } from "../lib/agent-contract.ts";

const HEX = (char) => char.repeat(64);
const PRODUCT_URI_RE = /^skilit:\/\/product\/[A-Za-z0-9_-]{1,128}$/;
const VERSION_URI_RE = /^skilit:\/\/version\/[A-Za-z0-9_-]{1,128}$/;

function assertStableEnvelope(envelope, context, mode = "observed") {
  assert.equal(envelope.schema_version, AGENT_SCHEMA_VERSION, `${context}: schema_version`);
  assert.ok(
    typeof envelope.request_id === "string" && envelope.request_id.length >= 1 && envelope.request_id.length <= 128,
    `${context}: request_id 1..128`,
  );
  assert.ok(envelope.status === "complete" || envelope.status === "partial", `${context}: status`);
  assert.ok(typeof envelope.result === "object" && envelope.result !== null, `${context}: result object`);
  if (envelope.provenance !== undefined) {
    assert.equal(envelope.provenance.evidence_mode, mode, `${context}: evidence_mode`);
  }
  const text = JSON.stringify(envelope);
  for (const leaked of ["Error:", "\n    at ", "/Users/", "/work/", "password", "secret", "BEGIN PRIVATE", "database error", "PGError", "stack"]) {
    assert.ok(!text.includes(leaked), `${context}: must not leak ${JSON.stringify(leaked)}`);
  }
}

async function mcpCall(db, ctx, name, args) {
  return dispatchMcp(db, ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
}

function mcpEnvelopeOf(response) {
  assert.ok(response.result?.content?.[0]?.text, "MCP success carries envelope text");
  return JSON.parse(response.result.content[0].text);
}

function mcpFailureEnvelopeOf(response) {
  assert.ok(response.error, "MCP failure carries JSON-RPC error");
  assert.ok(response.error.data?.envelope, "MCP failure carries envelope in data");
  return response.error.data.envelope;
}

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "gallery-t-owner@skilit.example", password: "gallery-password-01" });
  const outsider = await signUp(db, { email: "gallery-t-out@skilit.example", password: "gallery-password-01" });
  const source = await createSource(db, { key: "gallery-t-source", kind: "synthetic" });
  const product = await createProduct(db, { sourceId: source.id, title: "Gallery transport app" });
  const v1 = await createProductVersion(db, { productId: product.id, versionNo: 1 });
  const v2 = await createProductVersion(db, { productId: product.id, versionNo: 2 });
  const mk = (versionId, title) =>
    createArtifact(db, {
      sourceId: source.id,
      productId: product.id,
      productVersionId: versionId,
      kind: "screen",
      title,
      contentHash: HEX("a"),
      rightsClassification: "permitted",
      visibility: "public",
    });
  await mk(v1.id, "Gallery transport one");
  await mk(v2.id, "Gallery transport two");
  const space = await createWorkspace(db, { name: "Gallery transport", ownerId: owner.id });
  const hiddenProduct = await createProduct(db, { sourceId: source.id, title: "Gallery hidden app" });
  const hiddenVersion = await createProductVersion(db, { productId: hiddenProduct.id, versionNo: 1 });
  await createArtifact(db, {
    sourceId: source.id,
    productId: hiddenProduct.id,
    productVersionId: hiddenVersion.id,
    kind: "screen",
    title: "Gallery hidden screen",
    contentHash: HEX("b"),
    rightsClassification: "permitted",
    visibility: "private",
    workspaceId: space.workspace.id,
    ownerSubject: owner.id,
  });
  return { db, owner, outsider, source, product };
}

test("AF-14d: MCP and REST serve identical product and version galleries", async () => {
  const fx = await fixture();
  try {
    const mcp = await mcpCall(fx.db, { userId: fx.owner.id }, "list_products", {
      requestId: "req-gallery-parity-01",
    });
    const mcpEnvelope = mcpEnvelopeOf(mcp);
    assertStableEnvelope(mcpEnvelope, "MCP list_products");
    assert.equal(mcpEnvelope.request_id, "req-gallery-parity-01");
    assert.equal(mcpEnvelope.result.total, 2);
    assert.ok(mcpEnvelope.result.products.some((entry) => entry.title === "Gallery transport app"));

    const rest = await listProductsRoute(fx.db, {}, fx.owner.id, "req-gallery-parity-02");
    assert.equal(rest.status, 200);
    assertStableEnvelope(rest.body, "REST list_products");
    assert.deepEqual(rest.body.result, mcpEnvelope.result);

    const productId = mcpEnvelope.result.products
      .find((entry) => entry.title === "Gallery transport app")
      .uri.split("/").pop();
    const mcpVersions = mcpEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "list_product_versions", { productId }),
    );
    assertStableEnvelope(mcpVersions, "MCP list_product_versions");
    assert.equal(mcpVersions.result.total, 2);
    assert.deepEqual(mcpVersions.result.versions.map((entry) => entry.versionNo), [1, 2]);
    for (const entry of mcpVersions.result.versions) {
      assert.match(entry.uri, VERSION_URI_RE);
    }
    const restVersions = await listProductVersionsRoute(fx.db, productId, {}, fx.owner.id);
    assert.equal(restVersions.status, 200);
    assert.deepEqual(restVersions.body.result, mcpVersions.result);

    // Deterministic repeat across transports.
    const repeat = await listProductsRoute(fx.db, {}, fx.owner.id);
    assert.deepEqual(repeat.body.result, rest.body.result);
  } finally {
    await fx.db.close();
  }
});

test("AF-14d: pagination, validation, and unknown products match across transports", async () => {
  const fx = await fixture();
  try {
    const mcpPage = await mcpCall(fx.db, { userId: fx.owner.id }, "list_products", { limit: 1 });
    const pageOne = mcpEnvelopeOf(mcpPage);
    assert.equal(pageOne.result.products.length, 1);

    for (const bad of [{ limit: 0 }, { cursor: "!!!bad!!!" }]) {
      const restBad = await listProductsRoute(fx.db, bad, fx.owner.id);
      assert.equal(restBad.status, 400, `REST rejects ${JSON.stringify(bad)}`);
      assert.equal(restBad.body.error.code, "INVALID_INPUT");
      const mcpBad = await mcpCall(fx.db, { userId: fx.owner.id }, "list_products", bad);
      assert.equal(mcpFailureEnvelopeOf(mcpBad).error.code, "INVALID_INPUT", `MCP rejects ${JSON.stringify(bad)}`);
    }
    const ghost = "00000000-0000-7000-8000-000000000000";
    const mcpGhost = mcpEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "list_product_versions", { productId: ghost }),
    );
    assert.equal(mcpGhost.result.total, 0);
    assert.deepEqual(mcpGhost.result.versions, []);
    const restGhost = await listProductVersionsRoute(fx.db, ghost, {}, fx.owner.id);
    assert.equal(restGhost.status, 200);
    assert.deepEqual(restGhost.body.result, mcpGhost.result);

    const restMalformed = await listProductVersionsRoute(fx.db, "nope", {}, fx.owner.id);
    assert.equal(restMalformed.status, 400);
    const mcpMalformed = await mcpCall(fx.db, { userId: fx.owner.id }, "list_product_versions", {
      productId: "nope",
    });
    assert.equal(mcpFailureEnvelopeOf(mcpMalformed).error.code, "INVALID_INPUT");
    const mcpMissing = await mcpCall(fx.db, { userId: fx.owner.id }, "list_product_versions", {});
    assert.equal(mcpFailureEnvelopeOf(mcpMissing).error.code, "INVALID_INPUT");
  } finally {
    await fx.db.close();
  }
});

test("AF-14d: withheld products stay invisible to outsiders on both transports", async () => {
  const fx = await fixture();
  try {
    const outside = await listProductsRoute(fx.db, {}, fx.outsider.id);
    assert.equal(outside.status, 200);
    assert.equal(outside.body.result.total, 1);
    assert.ok(!outside.body.result.products.some((entry) => entry.title === "Gallery hidden app"));
    assert.ok(!JSON.stringify(outside.body).includes("Gallery hidden screen"));
    const mcpOutside = mcpEnvelopeOf(await mcpCall(fx.db, { userId: fx.outsider.id }, "list_products", {}));
    assert.deepEqual(mcpOutside.result, outside.body.result);

    const listed = mcpEnvelopeOf(await mcpCall(fx.db, { userId: fx.owner.id }, "list_products", {}));
    const hiddenUri = listed.result.products.find((entry) => entry.title === "Gallery hidden app");
    assert.ok(hiddenUri, "owner sees the private product");
    const hiddenVersions = await listProductVersionsRoute(
      fx.db,
      hiddenUri.uri.split("/").pop(),
      {},
      fx.outsider.id,
    );
    assert.equal(hiddenVersions.status, 200);
    assert.equal(hiddenVersions.body.result.total, 0);
  } finally {
    await fx.db.close();
  }
});
