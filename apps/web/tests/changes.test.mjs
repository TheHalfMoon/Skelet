import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createProduct, createProductVersion, createSource } from "../../../packages/db/src/repositories.ts";
import { createArtifact } from "../../../packages/db/src/graph.ts";
import { addFlowStep, createFlow } from "../../../packages/db/src/workflows.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { dispatchMcp } from "../lib/mcp.ts";
import { getChangesRoute } from "../lib/rest.ts";
import { AGENT_SCHEMA_VERSION } from "../lib/agent-contract.ts";

const HEX = (char) => char.repeat(64);

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
  const owner = await signUp(db, { email: "changes-t-owner@skelet.example", password: "changes-password-01" });
  const outsider = await signUp(db, { email: "changes-t-out@skelet.example", password: "changes-password-01" });
  const source = await createSource(db, { key: "changes-t-source", kind: "synthetic" });
  const product = await createProduct(db, { sourceId: source.id, title: "Transport app" });
  const v1 = await createProductVersion(db, { productId: product.id, versionNo: 1 });
  const v2 = await createProductVersion(db, { productId: product.id, versionNo: 2 });
  const mk = (versionId, title, hash, summary) =>
    createArtifact(db, {
      sourceId: source.id,
      productId: product.id,
      productVersionId: versionId,
      kind: "screen",
      title,
      summary,
      contentHash: hash,
      rightsClassification: "permitted",
      visibility: "public",
    });
  await mk(v1.id, "Keep screen", HEX("a"), "same");
  await mk(v1.id, "Old screen", HEX("b"), "gone");
  await mk(v1.id, "Edit screen", HEX("c"), "before");
  await mk(v2.id, "Keep screen", HEX("a"), "same");
  await mk(v2.id, "New screen", HEX("d"), "fresh");
  await mk(v2.id, "Edit screen", HEX("e"), "after");
  const flow1 = await createFlow(db, { sourceId: source.id, productVersionId: v1.id, title: "Tour" });
  const keepV1 = (await db.query(`select id from artifacts where product_version_id=$1 and title=$2`, [v1.id, "Keep screen"])).rows[0].id;
  await addFlowStep(db, { flowId: flow1.id, position: 0, artifactId: String(keepV1) });
  const flow2 = await createFlow(db, { sourceId: source.id, productVersionId: v2.id, title: "Tour" });
  const keepV2 = (await db.query(`select id from artifacts where product_version_id=$1 and title=$2`, [v2.id, "Keep screen"])).rows[0].id;
  await addFlowStep(db, { flowId: flow2.id, position: 0, artifactId: String(keepV2) });

  const space = await createWorkspace(db, { name: "Changes transport", ownerId: owner.id });
  const hiddenProduct = await createProduct(db, { sourceId: source.id, title: "Hidden app" });
  const hv1 = await createProductVersion(db, { productId: hiddenProduct.id, versionNo: 1 });
  const hv2 = await createProductVersion(db, { productId: hiddenProduct.id, versionNo: 2 });
  await createArtifact(db, {
    sourceId: source.id,
    productId: hiddenProduct.id,
    productVersionId: hv1.id,
    kind: "screen",
    title: "Hidden old",
    contentHash: HEX("1"),
    rightsClassification: "permitted",
    visibility: "private",
    workspaceId: space.workspace.id,
    ownerSubject: owner.id,
  });
  await createArtifact(db, {
    sourceId: source.id,
    productId: hiddenProduct.id,
    productVersionId: hv2.id,
    kind: "screen",
    title: "Hidden new",
    contentHash: HEX("2"),
    rightsClassification: "permitted",
    visibility: "private",
    workspaceId: space.workspace.id,
    ownerSubject: owner.id,
  });
  return { db, owner, outsider, source, product, v1, v2, hidden: { hv1, hv2 } };
}

test("AF-15a: MCP and REST serve identical version changes", async () => {
  const fx = await fixture();
  try {
    const mcp = await mcpCall(fx.db, { userId: fx.owner.id }, "get_changes", {
      fromVersionId: fx.v1.id,
      toVersionId: fx.v2.id,
      requestId: "req-changes-parity-01",
    });
    const mcpEnvelope = mcpEnvelopeOf(mcp);
    assertStableEnvelope(mcpEnvelope, "MCP get_changes");
    assert.equal(mcpEnvelope.request_id, "req-changes-parity-01");
    assert.equal(mcpEnvelope.error, undefined);
    assert.equal(mcpEnvelope.result.total, 3);
    assert.equal(mcpEnvelope.result.identical, false);
    assert.deepEqual(
      mcpEnvelope.result.changes.map((entry) => entry.key),
      ["screen::Edit screen", "screen::New screen", "screen::Old screen"],
    );

    const rest = await getChangesRoute(
      fx.db,
      { fromVersionId: fx.v1.id, toVersionId: fx.v2.id },
      fx.owner.id,
      "req-changes-parity-02",
    );
    assert.equal(rest.status, 200);
    assertStableEnvelope(rest.body, "REST get_changes");
    assert.deepEqual(rest.body.result, mcpEnvelope.result);

    // Deterministic repeat across transports.
    const repeat = await getChangesRoute(
      fx.db,
      { fromVersionId: fx.v1.id, toVersionId: fx.v2.id },
      fx.owner.id,
    );
    assert.deepEqual(repeat.body.result, rest.body.result);
  } finally {
    await fx.db.close();
  }
});

test("AF-15a: pagination, validation, and unsupported pairs match across transports", async () => {
  const fx = await fixture();
  try {
    const mcpPage = await mcpCall(fx.db, { userId: fx.owner.id }, "get_changes", {
      fromVersionId: fx.v1.id,
      toVersionId: fx.v2.id,
      limit: 1,
    });
    const pageOne = mcpEnvelopeOf(mcpPage);
    assert.equal(pageOne.result.changes.length, 1);
    assert.ok(typeof pageOne.cursor === "string");

    const restPage = await getChangesRoute(
      fx.db,
      { fromVersionId: fx.v1.id, toVersionId: fx.v2.id, limit: "1", cursor: pageOne.cursor },
      fx.owner.id,
    );
    assert.equal(restPage.status, 200);
    assert.equal(restPage.body.result.changes.length, 1);
    assert.notEqual(restPage.body.result.changes[0].id, pageOne.result.changes[0].id);

    for (const bad of [
      { fromVersionId: fx.v1.id, toVersionId: fx.v2.id, limit: "0" },
      { fromVersionId: fx.v1.id, toVersionId: fx.v2.id, cursor: "!!!bad!!!" },
      { fromVersionId: "nope", toVersionId: fx.v2.id },
      { fromVersionId: fx.v1.id },
    ]) {
      const restBad = await getChangesRoute(fx.db, bad, fx.owner.id);
      assert.equal(restBad.status, 400, `REST rejects ${JSON.stringify(bad)}`);
      assert.equal(restBad.body.error.code, "INVALID_INPUT");
      const mcpBad = await mcpCall(fx.db, { userId: fx.owner.id }, "get_changes", bad);
      const code = mcpFailureEnvelopeOf(mcpBad).error.code;
      assert.ok(code === "INVALID_INPUT" || code === "FORBIDDEN_OR_NOT_FOUND", `MCP rejects ${JSON.stringify(bad)}`);
    }

    // Cross-product pairs are unsupported on both transports.
    const other = await createProduct(fx.db, { sourceId: fx.source.id, title: "Other app" });
    const ov = await createProductVersion(fx.db, { productId: other.id, versionNo: 1 });
    const restUnsupported = await getChangesRoute(
      fx.db,
      { fromVersionId: fx.v1.id, toVersionId: ov.id },
      fx.owner.id,
    );
    assert.equal(restUnsupported.status, 400);
    assert.equal(restUnsupported.body.error.code, "INVALID_INPUT");
    const mcpUnsupported = await mcpCall(fx.db, { userId: fx.owner.id }, "get_changes", {
      fromVersionId: fx.v1.id,
      toVersionId: ov.id,
    });
    assert.equal(mcpFailureEnvelopeOf(mcpUnsupported).error.code, "INVALID_INPUT");

    // Missing identifiers stay invalid on MCP when omitted, not-found when unknown.
    const mcpMissing = await mcpCall(fx.db, { userId: fx.owner.id }, "get_changes", {});
    assert.equal(mcpFailureEnvelopeOf(mcpMissing).error.code, "INVALID_INPUT");
  } finally {
    await fx.db.close();
  }
});

test("AF-15a: unknown and private versions share no oracle", async () => {
  const fx = await fixture();
  try {
    const ghost = "00000000-0000-7000-8000-000000000000";
    const mcpGhost = mcpFailureEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "get_changes", {
        fromVersionId: ghost,
        toVersionId: fx.v1.id,
      }),
    );
    const mcpDenied = mcpEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.outsider.id }, "get_changes", {
        fromVersionId: fx.hidden.hv1.id,
        toVersionId: fx.hidden.hv2.id,
      }),
    );
    // Private versions still resolve as versions (no version-level denial),
    // but their unreadable artifacts yield an empty diff — never a leak.
    // Unknown versions answer not-found on both transports.
    assert.equal(mcpGhost.error.code, "FORBIDDEN_OR_NOT_FOUND");
    const restGhost = await getChangesRoute(
      fx.db,
      { fromVersionId: ghost, toVersionId: fx.v1.id },
      fx.owner.id,
    );
    assert.equal(restGhost.status, 404);
    assert.equal(restGhost.body.error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(mcpDenied.error, undefined, "private versions diff to empty, not denial");
    assert.equal(mcpDenied.result.total, 0);
    const restDenied = await getChangesRoute(
      fx.db,
      { fromVersionId: fx.hidden.hv1.id, toVersionId: fx.hidden.hv2.id },
      fx.outsider.id,
    );
    assert.equal(restDenied.status, 200);
    assert.equal(restDenied.body.result.total, 0);
    const text = JSON.stringify(restDenied.body);
    assert.ok(!text.includes("Hidden old"));
    assert.ok(!text.includes("Hidden new"));

    // Identical versions are empty on both transports.
    const mcpSame = mcpEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "get_changes", {
        fromVersionId: fx.v1.id,
        toVersionId: fx.v1.id,
      }),
    );
    assert.equal(mcpSame.result.identical, true);
    assert.deepEqual(mcpSame.result.changes, []);
    const restSame = await getChangesRoute(
      fx.db,
      { fromVersionId: fx.v1.id, toVersionId: fx.v1.id },
      fx.owner.id,
    );
    assert.equal(restSame.status, 200);
    assert.deepEqual(restSame.body.result, mcpSame.result);
  } finally {
    await fx.db.close();
  }
});
