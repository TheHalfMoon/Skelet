import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createProduct, createProductVersion, createSource } from "../../../packages/db/src/repositories.ts";
import { createArtifact } from "../../../packages/db/src/graph.ts";
import { createFlow, addFlowStep } from "../../../packages/db/src/workflows.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { dispatchMcp } from "../lib/mcp.ts";
import {
  closeReplaySessionRoute,
  getReplayEventsRoute,
  openReplaySessionRoute,
  recordReplayEventsRoute,
} from "../lib/rest.ts";
import { AGENT_SCHEMA_VERSION } from "../lib/agent-contract.ts";

const HEX = (char) => char.repeat(64);
const META = () => ({ type: 4, timestamp: 1_700_000_000_000, data: { href: "https://example.com/", width: 1280, height: 800 } });
const TYPING = () => ({ type: 3, timestamp: 1_700_000_000_001, data: { source: 5, text: "hello", isChecked: false } });

function assertStableEnvelope(envelope, context) {
  assert.equal(envelope.schema_version, AGENT_SCHEMA_VERSION, `${context}: schema_version`);
  assert.ok(
    typeof envelope.request_id === "string" && envelope.request_id.length >= 1 && envelope.request_id.length <= 128,
    `${context}: request_id 1..128`,
  );
  assert.ok(envelope.status === "complete" || envelope.status === "partial", `${context}: status`);
  assert.ok(typeof envelope.result === "object" && envelope.result !== null, `${context}: result object`);
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
  const owner = await signUp(db, { email: "replay-t-owner@skilit.example", password: "replay-password-01" });
  const outsider = await signUp(db, { email: "replay-t-out@skilit.example", password: "replay-password-01" });
  const source = await createSource(db, { key: "replay-t-source", kind: "synthetic" });
  const product = await createProduct(db, { sourceId: source.id, title: "Replay transport app" });
  const version = await createProductVersion(db, { productId: product.id, versionNo: 1 });
  const art = await createArtifact(db, {
    sourceId: source.id,
    productId: product.id,
    productVersionId: version.id,
    kind: "screen",
    title: "Replay transport screen",
    contentHash: HEX("a"),
    rightsClassification: "permitted",
    visibility: "public",
  });
  const flow = await createFlow(db, { sourceId: source.id, productVersionId: version.id, title: "Replay transport flow" });
  await addFlowStep(db, { flowId: flow.id, position: 0, artifactId: art.id, interaction: { kind: "open" } });
  return { db, owner, outsider, source, flow };
}

function sessionIdOf(uri) {
  return String(uri).split("/").pop();
}

test("P10-D2: MCP and REST serve identical replay lifecycles", async () => {
  const fx = await fixture();
  try {
    const mcpOpened = mcpEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "replay_open_session", {
        flowId: fx.flow.id,
        consent: "explicit",
        requestId: "req-replay-parity-01",
      }),
    );
    assertStableEnvelope(mcpOpened, "MCP replay_open_session");
    assert.equal(mcpOpened.request_id, "req-replay-parity-01");
    assert.ok(String(mcpOpened.result.session.uri).startsWith("skilit://replay/"));
    const sessionId = sessionIdOf(mcpOpened.result.session.uri);

    const restRecorded = await recordReplayEventsRoute(fx.db, sessionId, { events: [META(), TYPING()] }, fx.owner.id);
    assert.equal(restRecorded.status, 200);
    assertStableEnvelope(restRecorded.body, "REST replay_record_events");
    assert.equal(restRecorded.body.result.recorded, 2);

    const mcpEvents = mcpEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "replay_get_events", { sessionId }),
    );
    assertStableEnvelope(mcpEvents, "MCP replay_get_events");
    assert.equal(mcpEvents.result.total, 2);
    assert.deepEqual(mcpEvents.result.events.map((event) => event.type), [4, 3]);
    assert.equal(mcpEvents.result.events[1].data.text, "***");
    const restEvents = await getReplayEventsRoute(fx.db, sessionId, fx.owner.id);
    assert.equal(restEvents.status, 200);
    assert.deepEqual(restEvents.body.result, mcpEvents.result);

    const mcpClosed = mcpEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "replay_close_session", { sessionId }),
    );
    assert.equal(mcpClosed.result.session.status, "closed");
    const restClosed = await closeReplaySessionRoute(fx.db, sessionId, fx.owner.id);
    assert.equal(restClosed.status, 200);
    assert.deepEqual(restClosed.body.result.session.status, "closed");

    const restOpened = await openReplaySessionRoute(
      fx.db,
      { flowId: fx.flow.id, consent: "explicit" },
      fx.owner.id,
      "req-replay-parity-02",
    );
    assert.equal(restOpened.status, 200);
    assert.deepEqual(restOpened.body.result.session.uri.startsWith("skilit://replay/"), true);
  } finally {
    await fx.db.close();
  }
});

test("P10-D2: consent, envelopes, and foreign sessions match across transports", async () => {
  const fx = await fixture();
  try {
    const mcpDenied = await mcpCall(fx.db, { userId: fx.owner.id }, "replay_open_session", {
      flowId: fx.flow.id,
      consent: "implicit",
    });
    assert.equal(mcpFailureEnvelopeOf(mcpDenied).error.code, "INVALID_INPUT");
    const restDenied = await openReplaySessionRoute(fx.db, { flowId: fx.flow.id, consent: "implicit" }, fx.owner.id);
    assert.equal(restDenied.status, 400);

    const mcpBadEvents = await mcpCall(fx.db, { userId: fx.owner.id }, "replay_open_session", {
      flowId: fx.flow.id,
      consent: "explicit",
    });
    const sessionId = sessionIdOf(mcpEnvelopeOf(mcpBadEvents).result.session.uri);
    const mcpMalformed = await mcpCall(fx.db, { userId: fx.owner.id }, "replay_record_events", {
      sessionId,
      events: [{ type: 3, timestamp: 1, data: {}, extra: 1 }],
    });
    assert.equal(mcpFailureEnvelopeOf(mcpMalformed).error.code, "INVALID_INPUT");
    const restMalformed = await recordReplayEventsRoute(fx.db, sessionId, { events: "nope" }, fx.owner.id);
    assert.equal(restMalformed.status, 400);

    for (const name of ["replay_record_events", "replay_close_session", "replay_get_events"]) {
      const args = name === "replay_record_events" ? { sessionId, events: [META()] } : { sessionId };
      const denied = await mcpCall(fx.db, { userId: fx.outsider.id }, name, args);
      assert.equal(mcpFailureEnvelopeOf(denied).error.code, "FORBIDDEN_OR_NOT_FOUND", `MCP ${name} denies outsiders`);
    }
    assert.equal((await recordReplayEventsRoute(fx.db, sessionId, { events: [META()] }, fx.outsider.id)).status, 404);
    assert.equal((await closeReplaySessionRoute(fx.db, sessionId, fx.outsider.id)).status, 404);
    assert.equal((await getReplayEventsRoute(fx.db, sessionId, fx.outsider.id)).status, 404);

    const ghost = "00000000-0000-7000-8000-000000000000";
    const mcpGhost = await mcpCall(fx.db, { userId: fx.owner.id }, "replay_get_events", { sessionId: ghost });
    assert.equal(mcpFailureEnvelopeOf(mcpGhost).error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal((await getReplayEventsRoute(fx.db, ghost, fx.owner.id)).status, 404);
  } finally {
    await fx.db.close();
  }
});
