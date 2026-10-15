import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createSource } from "../../../packages/db/src/repositories.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { registerAsset } from "../../../packages/assets/src/registry.ts";
import { dispatchMcp } from "../lib/mcp.ts";
import { findSimilarRoute } from "../lib/rest.ts";
import { AGENT_SCHEMA_VERSION } from "../lib/agent-contract.ts";

const HASH = (char) => char.repeat(64);
const URI_RE = /^skelet:\/\/artifact\/[A-Za-z0-9_-]{1,128}$/;

function assertStableEnvelope(envelope, context) {
  assert.equal(envelope.schema_version, AGENT_SCHEMA_VERSION, `${context}: schema_version`);
  assert.ok(
    typeof envelope.request_id === "string" && envelope.request_id.length >= 1 && envelope.request_id.length <= 128,
    `${context}: request_id 1..128`,
  );
  assert.ok(envelope.status === "complete" || envelope.status === "partial", `${context}: status`);
  assert.ok(typeof envelope.result === "object" && envelope.result !== null, `${context}: result object`);
  if (envelope.provenance !== undefined) {
    assert.equal(envelope.provenance.evidence_mode, "deterministic-computation", `${context}: evidence_mode`);
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
  const owner = await signUp(db, { email: "similar-t-owner@skelet.example", password: "similar-password-01" });
  const outsider = await signUp(db, { email: "similar-t-out@skelet.example", password: "similar-password-01" });
  const source = await createSource(db, { key: "similar-t-source", kind: "synthetic" });
  const reference = await registerAsset(db, {
    kind: "icon",
    title: "Similar left arrow",
    summary: "Left navigation arrow",
    sourceId: source.id,
    contentHash: HASH("a"),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "similar-t-left", tags: ["arrow", "navigation"], license: "MIT" },
    asset: { sha256: HASH("a"), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/st/left" },
  });
  await registerAsset(db, {
    kind: "icon",
    title: "Similar right arrow",
    summary: "Right navigation arrow",
    sourceId: source.id,
    contentHash: HASH("b"),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "similar-t-right", tags: ["arrow", "navigation"], license: "MIT" },
    asset: { sha256: HASH("b"), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/st/right" },
  });
  await registerAsset(db, {
    kind: "icon",
    title: "Arrow upload",
    summary: "Upload marker",
    sourceId: source.id,
    contentHash: HASH("c"),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "similar-t-upload", tags: ["arrow"], license: "MIT" },
    asset: { sha256: HASH("c"), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/st/upload" },
  });
  const locked = await registerAsset(db, {
    kind: "icon",
    title: "Similar locked arrow",
    summary: "Locked navigation arrow",
    sourceId: source.id,
    contentHash: HASH("d"),
    rightsClassification: "restricted",
    metadata: { collection: "brand-corpus", ref: "similar-t-locked", tags: ["arrow"], license: "proprietary", trademark: true },
  });
  const space = await createWorkspace(db, { name: "Similar transport", ownerId: owner.id });
  const hidden = await registerAsset(db, {
    kind: "icon",
    title: "Similar hidden arrow",
    summary: "Hidden navigation arrow",
    sourceId: source.id,
    contentHash: HASH("f"),
    rightsClassification: "permitted",
    visibility: "private",
    workspaceId: space.workspace.id,
    ownerSubject: owner.id,
    metadata: { tags: ["arrow", "navigation"], license: "MIT" },
  });
  return { db, owner, outsider, source, reference, locked, hidden };
}

test("AF-13a-i: MCP and REST serve identical similar rankings", async () => {
  const fx = await fixture();
  try {
    const mcp = await mcpCall(fx.db, { userId: fx.owner.id }, "find_similar", {
      artifactId: fx.reference.artifactId,
      requestId: "req-similar-parity-01",
    });
    const mcpEnvelope = mcpEnvelopeOf(mcp);
    assertStableEnvelope(mcpEnvelope, "MCP find_similar");
    assert.equal(mcpEnvelope.request_id, "req-similar-parity-01");
    assert.equal(mcpEnvelope.error, undefined);
    assert.equal(mcpEnvelope.result.reference.uri, `skelet://artifact/${fx.reference.artifactId}`);
    assert.ok(mcpEnvelope.result.similar.length >= 2);
    assert.equal(mcpEnvelope.result.total, mcpEnvelope.result.similar.length);
    assert.equal(mcpEnvelope.result.truncated, false);
    for (const entry of mcpEnvelope.result.similar) {
      assert.ok(URI_RE.test(entry.uri));
      assert.equal(typeof entry.score, "number");
      assert.ok(entry.score > 0 && entry.score <= 1);
    }

    const rest = await findSimilarRoute(
      fx.db,
      { artifactId: fx.reference.artifactId },
      fx.owner.id,
      "req-similar-parity-02",
    );
    assert.equal(rest.status, 200);
    assertStableEnvelope(rest.body, "REST find_similar");
    assert.equal(rest.body.request_id, "req-similar-parity-02");
    // Parity by construction: same route-layer outcome, same order/scores.
    assert.deepEqual(rest.body.result.similar, mcpEnvelope.result.similar);
    assert.deepEqual(rest.body.result.reference, mcpEnvelope.result.reference);
    assert.equal(rest.body.result.total, mcpEnvelope.result.total);
  } finally {
    await fx.db.close();
  }
});

test("AF-13a-i: pagination, filters, and invalid inputs match across transports", async () => {
  const fx = await fixture();
  try {
    const mcpPage = await mcpCall(fx.db, { userId: fx.owner.id }, "find_similar", {
      artifactId: fx.reference.artifactId,
      limit: 1,
    });
    const pageOne = mcpEnvelopeOf(mcpPage);
    assert.equal(pageOne.result.similar.length, 1);
    assert.ok(typeof pageOne.cursor === "string");

    const restPage = await findSimilarRoute(
      fx.db,
      { artifactId: fx.reference.artifactId, limit: "1", cursor: pageOne.cursor },
      fx.owner.id,
    );
    assert.equal(restPage.status, 200);
    assert.equal(restPage.body.result.similar.length, 1);
    assert.notEqual(restPage.body.result.similar[0].uri, pageOne.result.similar[0].uri);

    const logos = await findSimilarRoute(
      fx.db,
      { artifactId: fx.reference.artifactId, kinds: "logo" },
      fx.owner.id,
    );
    assert.equal(logos.status, 200);
    assert.deepEqual(logos.body.result.similar, []);

    for (const bad of [
      { artifactId: fx.reference.artifactId, kinds: "spaceship" },
      { artifactId: fx.reference.artifactId, kinds: "icon,icon" },
      { artifactId: fx.reference.artifactId, limit: "0" },
      { artifactId: fx.reference.artifactId, cursor: "!!!bad!!!" },
    ]) {
      const restBad = await findSimilarRoute(fx.db, bad, fx.owner.id);
      assert.equal(restBad.status, 400, `REST rejects ${JSON.stringify(bad)}`);
      assert.equal(restBad.body.error.code, "INVALID_INPUT");
      const mcpBad = await mcpCall(fx.db, { userId: fx.owner.id }, "find_similar", bad);
      assert.equal(mcpFailureEnvelopeOf(mcpBad).error.code, "INVALID_INPUT", `MCP rejects ${JSON.stringify(bad)}`);
    }
    // Malformed references are never an oracle: 404 on REST,
    // FORBIDDEN_OR_NOT_FOUND on MCP, exactly like unknown IDs.
    const restMalformed = await findSimilarRoute(fx.db, { artifactId: "not-a-uuid" }, fx.owner.id);
    assert.equal(restMalformed.status, 404);
    const mcpMalformed = await mcpCall(fx.db, { userId: fx.owner.id }, "find_similar", { artifactId: "not-a-uuid" });
    assert.equal(mcpFailureEnvelopeOf(mcpMalformed).error.code, "FORBIDDEN_OR_NOT_FOUND");
    const missing = await mcpCall(fx.db, { userId: fx.owner.id }, "find_similar", {});
    assert.equal(mcpFailureEnvelopeOf(missing).error.code, "INVALID_INPUT");
  } finally {
    await fx.db.close();
  }
});

test("AF-13a-i: unknown, denied, and restricted references share no oracle", async () => {
  const fx = await fixture();
  try {
    const ghost = "00000000-0000-7000-8000-000000000000";
    const mcpGhost = mcpFailureEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "find_similar", { artifactId: ghost }),
    );
    const mcpDenied = mcpFailureEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.outsider.id }, "find_similar", { artifactId: fx.hidden.artifactId }),
    );
    assert.equal(mcpGhost.error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(mcpDenied.error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(mcpGhost.error.message, mcpDenied.error.message);

    const restGhost = await findSimilarRoute(fx.db, { artifactId: ghost }, fx.owner.id);
    const restDenied = await findSimilarRoute(fx.db, { artifactId: fx.hidden.artifactId }, fx.outsider.id);
    assert.equal(restGhost.status, 404);
    assert.equal(restDenied.status, 404);
    assert.equal(restGhost.body.error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(restDenied.body.error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(restGhost.body.error.message, restDenied.body.error.message);

    // Restricted references answer RIGHTS_RESTRICTED on both transports.
    const mcpLocked = mcpFailureEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "find_similar", { artifactId: fx.locked.artifactId }),
    );
    assert.equal(mcpLocked.error.code, "RIGHTS_RESTRICTED");
    const restLocked = await findSimilarRoute(fx.db, { artifactId: fx.locked.artifactId }, fx.owner.id);
    assert.equal(restLocked.status, 403);
    assert.equal(restLocked.body.error.code, "RIGHTS_RESTRICTED");

    // Private candidates never leak to outsiders.
    const outside = await findSimilarRoute(fx.db, { artifactId: fx.reference.artifactId }, fx.outsider.id);
    assert.equal(outside.status, 200);
    assert.ok(!outside.body.result.similar.some((entry) => entry.uri === `skelet://artifact/${fx.hidden.artifactId}`));
  } finally {
    await fx.db.close();
  }
});

test("AF-14b-i: screens serve identical similarity rankings on MCP and REST", async () => {
  const db = await openDatabase();
  try {
    await migrateUp(db);
    const { createArtifact: make } = await import("../../../packages/db/src/graph.ts");
    const owner = await signUp(db, { email: "similar-ts-owner@skelet.example", password: "similar-password-01" });
    const outsider = await signUp(db, { email: "similar-ts-out@skelet.example", password: "similar-password-01" });
    const source = await createSource(db, { key: "similar-ts-source", kind: "synthetic" });
    const ref = await make(db, {
      sourceId: source.id,
      kind: "screen",
      title: "Checkout screen",
      summary: "Payment form checkout",
      contentHash: HASH("a"),
      rightsClassification: "permitted",
      visibility: "public",
      metadata: { tags: ["checkout"] },
    });
    await make(db, {
      sourceId: source.id,
      kind: "screen",
      title: "Checkout form screen",
      summary: "Payment checkout form",
      contentHash: HASH("b"),
      rightsClassification: "permitted",
      visibility: "public",
      metadata: { tags: ["checkout"] },
    });
    const space = await createWorkspace(db, { name: "Similar transport screens", ownerId: owner.id });
    const hidden = await make(db, {
      sourceId: source.id,
      kind: "screen",
      title: "Checkout hidden screen",
      summary: "Payment form checkout",
      contentHash: HASH("c"),
      rightsClassification: "permitted",
      visibility: "private",
      workspaceId: space.workspace.id,
      ownerSubject: owner.id,
      metadata: { tags: ["checkout"] },
    });

    const mcp = await mcpCall(db, { userId: owner.id }, "find_similar", {
      artifactId: ref.id,
      kinds: ["screen"],
      requestId: "req-similar-screen-01",
    });
    const mcpEnvelope = mcpEnvelopeOf(mcp);
    assertStableEnvelope(mcpEnvelope, "MCP find_similar screens");
    assert.ok(mcpEnvelope.result.similar.length >= 1);
    assert.ok(mcpEnvelope.result.similar.every((entry) => entry.kind === "screen"));

    const rest = await findSimilarRoute(db, { artifactId: ref.id, kinds: "screen" }, owner.id, "req-similar-screen-02");
    assert.equal(rest.status, 200);
    assertStableEnvelope(rest.body, "REST find_similar screens");
    assert.deepEqual(rest.body.result.similar, mcpEnvelope.result.similar);
    assert.deepEqual(rest.body.result.reference, mcpEnvelope.result.reference);

    // Expanded kinds validate on both transports; unknown kinds still fail.
    const badRest = await findSimilarRoute(db, { artifactId: ref.id, kinds: "spaceship" }, owner.id);
    assert.equal(badRest.status, 400);
    const badMcp = await mcpCall(db, { userId: owner.id }, "find_similar", { artifactId: ref.id, kinds: ["spaceship"] });
    assert.equal(mcpFailureEnvelopeOf(badMcp).error.code, "INVALID_INPUT");

    // Private screens never leak to outsiders on either transport.
    const outside = await findSimilarRoute(db, { artifactId: ref.id }, outsider.id);
    assert.equal(outside.status, 200);
    assert.ok(!outside.body.result.similar.some((entry) => entry.uri === `skelet://artifact/${hidden.id}`));
    const denied = mcpFailureEnvelopeOf(
      await mcpCall(db, { userId: outsider.id }, "find_similar", { artifactId: hidden.id }),
    );
    assert.equal(denied.error.code, "FORBIDDEN_OR_NOT_FOUND");
  } finally {
    await db.close();
  }
});
