import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createSource } from "../../../packages/db/src/repositories.ts";
import { createArtifact, createPattern, createRelation } from "../../../packages/db/src/graph.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { dispatchMcp } from "../lib/mcp.ts";
import { getPatternRoute, listPatternsRoute } from "../lib/rest.ts";
import { AGENT_SCHEMA_VERSION } from "../lib/agent-contract.ts";

const HEX = (char) => char.repeat(64);
const PATTERN_URI_RE = /^skelet:\/\/pattern\/[a-z0-9-]{1,64}$/;

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
  const owner = await signUp(db, { email: "pattern-t-owner@skelet.example", password: "pattern-password-01" });
  const outsider = await signUp(db, { email: "pattern-t-out@skelet.example", password: "pattern-password-01" });
  const source = await createSource(db, { key: "pattern-t-source", kind: "synthetic" });
  const entry = await createPattern(db, { slug: "transport-pattern", title: "Transport pattern", sourceId: source.id });
  const art = await createArtifact(db, {
    sourceId: source.id,
    kind: "screen",
    title: "Transport screen",
    contentHash: HEX("a"),
    rightsClassification: "permitted",
    visibility: "public",
  });
  await createRelation(db, { fromType: "pattern", fromId: entry.id, relationType: "appears_in", toType: "artifact", toId: art.id });
  return { db, owner, outsider, source, entry };
}

test("P10-C: MCP and REST serve identical pattern taxonomy", async () => {
  const fx = await fixture();
  try {
    const mcp = await mcpCall(fx.db, { userId: fx.owner.id }, "list_patterns", {
      requestId: "req-pattern-parity-01",
    });
    const mcpEnvelope = mcpEnvelopeOf(mcp);
    assertStableEnvelope(mcpEnvelope, "MCP list_patterns");
    assert.equal(mcpEnvelope.request_id, "req-pattern-parity-01");
    assert.equal(mcpEnvelope.result.total, 1);
    assert.match(mcpEnvelope.result.patterns[0].uri, PATTERN_URI_RE);

    const rest = await listPatternsRoute(fx.db, {}, fx.owner.id, "req-pattern-parity-02");
    assert.equal(rest.status, 200);
    assertStableEnvelope(rest.body, "REST list_patterns");
    assert.deepEqual(rest.body.result, mcpEnvelope.result);

    const mcpDetail = mcpEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "get_pattern", { slug: "transport-pattern" }),
    );
    assertStableEnvelope(mcpDetail, "MCP get_pattern");
    assert.equal(mcpDetail.result.pattern.uri, "skelet://pattern/transport-pattern");
    assert.equal(mcpDetail.result.links.length, 1);
    assert.ok(mcpDetail.result.links[0].uri.startsWith("skelet://artifact/"));
    const restDetail = await getPatternRoute(fx.db, "transport-pattern", fx.owner.id);
    assert.equal(restDetail.status, 200);
    assert.deepEqual(restDetail.body.result, mcpDetail.result);

    const repeat = await listPatternsRoute(fx.db, {}, fx.owner.id);
    assert.deepEqual(repeat.body.result, rest.body.result);
  } finally {
    await fx.db.close();
  }
});

test("P10-C: pagination, validation, and unknown slugs match across transports", async () => {
  const fx = await fixture();
  try {
    const mcpPage = await mcpCall(fx.db, { userId: fx.owner.id }, "list_patterns", { limit: 1 });
    const pageOne = mcpEnvelopeOf(mcpPage);
    assert.equal(pageOne.result.patterns.length, 1);

    for (const bad of [{ limit: 0 }, { cursor: "!!!bad!!!" }, { query: "" }]) {
      const restBad = await listPatternsRoute(fx.db, bad, fx.owner.id);
      assert.equal(restBad.status, 400, `REST rejects ${JSON.stringify(bad)}`);
      assert.equal(restBad.body.error.code, "INVALID_INPUT");
      const mcpBad = await mcpCall(fx.db, { userId: fx.owner.id }, "list_patterns", bad);
      assert.equal(mcpFailureEnvelopeOf(mcpBad).error.code, "INVALID_INPUT", `MCP rejects ${JSON.stringify(bad)}`);
    }
    const mcpGhost = await mcpCall(fx.db, { userId: fx.owner.id }, "get_pattern", { slug: "no-such-pattern" });
    assert.equal(mcpFailureEnvelopeOf(mcpGhost).error.code, "FORBIDDEN_OR_NOT_FOUND");
    const restGhost = await getPatternRoute(fx.db, "no-such-pattern", fx.owner.id);
    assert.equal(restGhost.status, 404);
    const restMalformed = await getPatternRoute(fx.db, "Uppercase", fx.owner.id);
    assert.equal(restMalformed.status, 400);
  } finally {
    await fx.db.close();
  }
});

test("P10-C: withheld patterns never leak across transports", async () => {
  const fx = await fixture();
  try {
    const space = await createWorkspace(fx.db, { name: "Pattern transport vault", ownerId: fx.owner.id });
    const hiddenArt = await createArtifact(fx.db, {
      sourceId: fx.source.id,
      kind: "screen",
      title: "Transport vault screen",
      contentHash: HEX("b"),
      rightsClassification: "permitted",
      visibility: "private",
      workspaceId: space.workspace.id,
      ownerSubject: fx.owner.id,
    });
    const hidden = await createPattern(fx.db, { slug: "vault-pattern", title: "Vault", sourceId: fx.source.id });
    await createRelation(fx.db, { fromType: "pattern", fromId: hidden.id, relationType: "references", toType: "artifact", toId: hiddenArt.id });
    const outside = await listPatternsRoute(fx.db, {}, fx.outsider.id);
    assert.equal(outside.body.result.total, 1);
    assert.ok(!JSON.stringify(outside.body).includes("vault-pattern"));
    const outsideDetail = await getPatternRoute(fx.db, "vault-pattern", fx.outsider.id);
    assert.equal(outsideDetail.status, 404);
    const mcpDenied = await mcpCall(fx.db, { userId: fx.outsider.id }, "get_pattern", { slug: "vault-pattern" });
    assert.equal(mcpFailureEnvelopeOf(mcpDenied).error.code, "FORBIDDEN_OR_NOT_FOUND");
    const inside = await getPatternRoute(fx.db, "vault-pattern", fx.owner.id);
    assert.equal(inside.status, 200);
  } finally {
    await fx.db.close();
  }
});
