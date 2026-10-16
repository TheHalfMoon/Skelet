import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createSource } from "../../../packages/db/src/repositories.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { registerAsset } from "../../../packages/assets/src/registry.ts";
import { dispatchMcp } from "../lib/mcp.ts";
import { compareArtifactsRoute } from "../lib/rest.ts";
import { AGENT_SCHEMA_VERSION } from "../lib/agent-contract.ts";

const HASH = (char) => char.repeat(64);
const URI_RE = /^skilit:\/\/artifact\/[A-Za-z0-9_-]{1,128}$/;

function assertStableEnvelope(envelope, context) {
  assert.equal(envelope.schema_version, AGENT_SCHEMA_VERSION, `${context}: schema_version`);
  assert.ok(
    typeof envelope.request_id === "string" && envelope.request_id.length >= 1 && envelope.request_id.length <= 128,
    `${context}: request_id 1..128`,
  );
  assert.equal(envelope.status, "complete", `${context}: status complete`);
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
  const owner = await signUp(db, { email: "compare-t-owner@skilit.example", password: "compare-password-01" });
  const outsider = await signUp(db, { email: "compare-t-out@skilit.example", password: "compare-password-01" });
  const source = await createSource(db, { key: "compare-t-source", kind: "synthetic" });
  const left = await registerAsset(db, {
    kind: "icon",
    title: "Compare left arrow",
    summary: "Left navigation arrow",
    sourceId: source.id,
    contentHash: HASH("a"),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "compare-t-left", tags: ["arrow", "navigation"], license: "MIT" },
    asset: { sha256: HASH("a"), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/ct/left" },
  });
  const right = await registerAsset(db, {
    kind: "icon",
    title: "Compare right arrow",
    summary: "Right navigation arrow",
    sourceId: source.id,
    contentHash: HASH("b"),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "compare-t-right", tags: ["arrow", "navigation"], license: "MIT" },
    asset: { sha256: HASH("b"), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/ct/right" },
  });
  const locked = await registerAsset(db, {
    kind: "icon",
    title: "Compare locked arrow",
    summary: "Locked navigation arrow",
    sourceId: source.id,
    contentHash: HASH("d"),
    rightsClassification: "restricted",
    metadata: { collection: "brand-corpus", ref: "compare-t-locked", tags: ["arrow"], license: "proprietary", trademark: true },
  });
  const space = await createWorkspace(db, { name: "Compare transport", ownerId: owner.id });
  const hidden = await registerAsset(db, {
    kind: "icon",
    title: "Compare hidden arrow",
    summary: "Hidden navigation arrow",
    sourceId: source.id,
    contentHash: HASH("f"),
    rightsClassification: "permitted",
    visibility: "private",
    workspaceId: space.workspace.id,
    ownerSubject: owner.id,
    metadata: { tags: ["arrow", "navigation"], license: "MIT" },
  });
  return { db, owner, outsider, left, right, locked, hidden };
}

test("AF-13a-ii: MCP and REST serve identical comparison diffs", async () => {
  const fx = await fixture();
  try {
    const mcp = await mcpCall(fx.db, { userId: fx.owner.id }, "compare_design", {
      leftArtifactId: fx.left.artifactId,
      rightArtifactId: fx.right.artifactId,
      requestId: "req-compare-parity-01",
    });
    const mcpEnvelope = mcpEnvelopeOf(mcp);
    assertStableEnvelope(mcpEnvelope, "MCP compare_design");
    assert.equal(mcpEnvelope.request_id, "req-compare-parity-01");
    assert.equal(mcpEnvelope.error, undefined);
    assert.equal(mcpEnvelope.result.left.uri, `skilit://artifact/${fx.left.artifactId}`);
    assert.equal(mcpEnvelope.result.right.uri, `skilit://artifact/${fx.right.artifactId}`);
    assert.ok(URI_RE.test(mcpEnvelope.result.left.uri));
    assert.equal(mcpEnvelope.result.identical, false);
    assert.equal(mcpEnvelope.result.score, 0.6);
    assert.deepEqual(mcpEnvelope.result.sharedTerms, ["arrow", "compare", "navigation"]);

    const rest = await compareArtifactsRoute(
      fx.db,
      { left: fx.left.artifactId, right: fx.right.artifactId },
      fx.owner.id,
      "req-compare-parity-02",
    );
    assert.equal(rest.status, 200);
    assertStableEnvelope(rest.body, "REST compare_design");
    assert.equal(rest.body.request_id, "req-compare-parity-02");
    // Parity by construction: same route-layer outcome, same diff.
    assert.deepEqual(rest.body.result, mcpEnvelope.result);

    // Reversed operands mirror: sides swap, terms swap, score holds.
    const reversed = await compareArtifactsRoute(
      fx.db,
      { left: fx.right.artifactId, right: fx.left.artifactId },
      fx.owner.id,
    );
    assert.equal(reversed.status, 200);
    assert.equal(reversed.body.result.score, 0.6);
    assert.deepEqual(reversed.body.result.uniqueLeft, mcpEnvelope.result.uniqueRight);
    assert.deepEqual(reversed.body.result.uniqueRight, mcpEnvelope.result.uniqueLeft);

    // Missing operands stay INVALID_INPUT on both transports.
    const restMissing = await compareArtifactsRoute(fx.db, { left: fx.left.artifactId }, fx.owner.id);
    assert.equal(restMissing.status, 400);
    const mcpMissing = await mcpCall(fx.db, { userId: fx.owner.id }, "compare_design", {
      leftArtifactId: fx.left.artifactId,
    });
    assert.equal(mcpFailureEnvelopeOf(mcpMissing).error.code, "INVALID_INPUT");
  } finally {
    await fx.db.close();
  }
});

test("AF-13a-ii: unknown, denied, and restricted pairs share no oracle", async () => {
  const fx = await fixture();
  try {
    const ghost = "00000000-0000-7000-8000-000000000000";
    const mcpGhost = mcpFailureEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "compare_design", {
        leftArtifactId: ghost,
        rightArtifactId: fx.right.artifactId,
      }),
    );
    const mcpDenied = mcpFailureEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.outsider.id }, "compare_design", {
        leftArtifactId: fx.left.artifactId,
        rightArtifactId: fx.hidden.artifactId,
      }),
    );
    assert.equal(mcpGhost.error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(mcpDenied.error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(mcpGhost.error.message, mcpDenied.error.message);

    const restGhost = await compareArtifactsRoute(
      fx.db,
      { left: ghost, right: fx.right.artifactId },
      fx.owner.id,
    );
    const restDenied = await compareArtifactsRoute(
      fx.db,
      { left: fx.left.artifactId, right: fx.hidden.artifactId },
      fx.outsider.id,
    );
    assert.equal(restGhost.status, 404);
    assert.equal(restDenied.status, 404);
    assert.equal(restGhost.body.error.message, restDenied.body.error.message);

    // A restricted artifact on either side denies the pair on both transports.
    const mcpLocked = mcpFailureEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "compare_design", {
        leftArtifactId: fx.locked.artifactId,
        rightArtifactId: fx.right.artifactId,
      }),
    );
    assert.equal(mcpLocked.error.code, "RIGHTS_RESTRICTED");
    const restLocked = await compareArtifactsRoute(
      fx.db,
      { left: fx.right.artifactId, right: fx.locked.artifactId },
      fx.owner.id,
    );
    assert.equal(restLocked.status, 403);
    assert.equal(restLocked.body.error.code, "RIGHTS_RESTRICTED");
  } finally {
    await fx.db.close();
  }
});
