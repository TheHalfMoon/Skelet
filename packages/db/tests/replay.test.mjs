import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../db/src/db.ts";
import { migrateUp } from "../../db/src/migrate.ts";
import { createProduct, createProductVersion, createSource } from "../../db/src/repositories.ts";
import { createArtifact } from "../../db/src/graph.ts";
import { createFlow, addFlowStep } from "../../db/src/workflows.ts";
import { signUp } from "../../db/src/auth.ts";
import { createWorkspace } from "../../db/src/workspaces.ts";
import {
  ReplayError,
  closeReplaySession,
  getReplayEvents,
  maskReplayEvent,
  openReplaySession,
  recordReplayEvents,
  validateReplayEvent,
} from "../src/replay.ts";

const HEX = (char) => char.repeat(64);
const META = () => ({ type: 4, timestamp: 1_700_000_000_000, data: { href: "https://example.com/", width: 1280, height: 800 } });
const INPUT = (text) => ({ type: 3, timestamp: 1_700_000_000_001, data: { source: 5, text, isChecked: false } });

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "replay-owner@skilit.example", password: "replay-password-01" });
  const outsider = await signUp(db, { email: "replay-out@skilit.example", password: "replay-password-01" });
  const source = await createSource(db, { key: "replay-source", kind: "synthetic" });
  const product = await createProduct(db, { sourceId: source.id, title: "Replay app" });
  const version = await createProductVersion(db, { productId: product.id, versionNo: 1 });
  const art = await createArtifact(db, {
    sourceId: source.id,
    productId: product.id,
    productVersionId: version.id,
    kind: "screen",
    title: "Replay screen",
    contentHash: HEX("a"),
    rightsClassification: "permitted",
    visibility: "public",
  });
  const flow = await createFlow(db, { sourceId: source.id, productVersionId: version.id, title: "Replay flow" });
  await addFlowStep(db, { flowId: flow.id, position: 0, artifactId: art.id, interaction: { kind: "open" } });
  return { db, owner, outsider, source, flow };
}

test("P10-D1: sessions open only with explicit consent on readable flows", async () => {
  const fx = await fixture();
  try {
    await assert.rejects(
      openReplaySession(fx.db, { flowId: fx.flow.id, actorId: fx.owner.id, consent: "implicit" }),
      (error) => error instanceof ReplayError && error.code === "replay/invalid-input",
    );
    await assert.rejects(
      openReplaySession(fx.db, { flowId: "nope", actorId: fx.owner.id, consent: "explicit" }),
      (error) => error instanceof ReplayError && error.code === "replay/invalid-input",
    );
    assert.equal(
      await openReplaySession(fx.db, { flowId: "00000000-0000-7000-8000-000000000000", actorId: fx.owner.id, consent: "explicit" }),
      null,
    );
    const session = await openReplaySession(fx.db, { flowId: fx.flow.id, actorId: fx.owner.id, consent: "explicit" });
    assert.ok(session !== null && session.status === "open" && session.eventCount === 0);
  } finally {
    await fx.db.close();
  }
});

test("P10-D1: record masks sensitive inputs before storage and replays in order", async () => {
  const fx = await fixture();
  try {
    const session = await openReplaySession(fx.db, { flowId: fx.flow.id, actorId: fx.owner.id, consent: "explicit" });
    assert.ok(session !== null);
    const stored = await recordReplayEvents(fx.db, {
      sessionId: session.id,
      actorId: fx.owner.id,
      events: [META(), INPUT("s3cr3t-p@ss"), { type: 2, timestamp: 1_700_000_000_002, data: {} }],
    });
    assert.ok(stored !== null && stored.recorded === 3);
    const replay = await getReplayEvents(fx.db, { sessionId: session.id, actorId: fx.owner.id });
    assert.ok(replay !== null && replay.events.length === 3);
    assert.deepEqual(replay.events.map((event) => event.type), [4, 3, 2]);
    const input = replay.events.find((event) => event.type === 3);
    assert.equal(input.data.text, "***");
    assert.equal(input.data.isChecked, false);
    assert.ok(!JSON.stringify(replay).includes("s3cr3t-p@ss"));
    assert.deepEqual(await getReplayEvents(fx.db, { sessionId: session.id, actorId: fx.owner.id }), replay);
  } finally {
    await fx.db.close();
  }
});

test("P10-D1: mutation values and credential customs are redacted", async () => {
  assert.equal(
    maskReplayEvent({
      type: 3,
      timestamp: 1,
      data: { source: 0, adds: [{ node: { tagName: "input", attributes: { value: "hunter2", type: "password" } } }] },
    }).data.adds[0].node.attributes.value,
    undefined,
  );
  const custom = maskReplayEvent({ type: 5, timestamp: 1, data: { tag: "login", payload: { password: "hunter2" } } });
  assert.deepEqual(custom.data, { tag: "redacted", payload: { redacted: true } });
  const benign = maskReplayEvent({ type: 5, timestamp: 1, data: { tag: "viewport", payload: { width: 10 } } });
  assert.deepEqual(benign.data, { tag: "viewport", payload: { width: 10 } });
});

test("P10-D1: malformed envelopes fail closed", async () => {
  for (const bad of [
    null,
    { type: 3, timestamp: 1 },
    { type: 3, timestamp: 1, data: {}, extra: 1 },
    { type: 99, timestamp: 1, data: {} },
    { type: 3, timestamp: -1, data: {} },
    { type: 3, timestamp: 1, data: [] },
  ]) {
    assert.throws(() => validateReplayEvent(bad), (error) => error instanceof ReplayError, JSON.stringify(bad));
  }
  const fx = await fixture();
  try {
    const session = await openReplaySession(fx.db, { flowId: fx.flow.id, actorId: fx.owner.id, consent: "explicit" });
    assert.ok(session !== null);
    await assert.rejects(
      recordReplayEvents(fx.db, { sessionId: session.id, actorId: fx.owner.id, events: [] }),
      (error) => error instanceof ReplayError && error.code === "replay/invalid-input",
    );
    await assert.rejects(
      recordReplayEvents(fx.db, { sessionId: session.id, actorId: fx.owner.id, events: [{ type: 3, timestamp: 1, data: {}, extra: 1 }] }),
      (error) => error instanceof ReplayError && error.code === "replay/invalid-input",
    );
  } finally {
    await fx.db.close();
  }
});

test("P10-D1: sessions close and refuse further writes with stable reads", async () => {
  const fx = await fixture();
  try {
    const session = await openReplaySession(fx.db, { flowId: fx.flow.id, actorId: fx.owner.id, consent: "explicit" });
    assert.ok(session !== null);
    await recordReplayEvents(fx.db, { sessionId: session.id, actorId: fx.owner.id, events: [META()] });
    const closed = await closeReplaySession(fx.db, { sessionId: session.id, actorId: fx.owner.id });
    assert.ok(closed !== null && closed.status === "closed");
    await assert.rejects(
      recordReplayEvents(fx.db, { sessionId: session.id, actorId: fx.owner.id, events: [META()] }),
      (error) => error instanceof ReplayError && error.code === "replay/closed",
    );
    const replay = await getReplayEvents(fx.db, { sessionId: session.id, actorId: fx.owner.id });
    assert.ok(replay !== null && replay.events.length === 1 && replay.session.status === "closed");
  } finally {
    await fx.db.close();
  }
});

test("P10-D1: session budgets fail closed without partial writes", async () => {
  const fx = await fixture();
  try {
    const session = await openReplaySession(fx.db, { flowId: fx.flow.id, actorId: fx.owner.id, consent: "explicit" });
    assert.ok(session !== null);
    const tiny = { type: 2, timestamp: 1, data: {} };
    for (let batch = 0; batch < 4; batch += 1) {
      const events = Array.from({ length: 500 }, () => ({ ...tiny }));
      const stored = await recordReplayEvents(fx.db, { sessionId: session.id, actorId: fx.owner.id, events });
      assert.ok(stored !== null && stored.recorded === 500);
    }
    await assert.rejects(
      recordReplayEvents(fx.db, { sessionId: session.id, actorId: fx.owner.id, events: [tiny] }),
      (error) => error instanceof ReplayError && error.code === "replay/budget-exceeded",
    );
    const replay = await getReplayEvents(fx.db, { sessionId: session.id, actorId: fx.owner.id });
    assert.ok(replay !== null && replay.events.length === 2000);
  } finally {
    await fx.db.close();
  }
});

test("P10-D1: outsiders and foreign sessions read as null with no oracle", async () => {
  const fx = await fixture();
  try {
    const space = await createWorkspace(fx.db, { name: "Replay vault", ownerId: fx.owner.id });
    const product = await createProduct(fx.db, { sourceId: fx.source.id, title: "Vault app" });
    const version = await createProductVersion(fx.db, { productId: product.id, versionNo: 1 });
    const hiddenArt = await createArtifact(fx.db, {
      sourceId: fx.source.id,
      productId: product.id,
      productVersionId: version.id,
      kind: "screen",
      title: "Vault screen",
      contentHash: HEX("b"),
      rightsClassification: "permitted",
      visibility: "private",
      workspaceId: space.workspace.id,
      ownerSubject: fx.owner.id,
    });
    const hiddenFlow = await createFlow(fx.db, { sourceId: fx.source.id, productVersionId: version.id, title: "Vault flow" });
    await addFlowStep(fx.db, { flowId: hiddenFlow.id, position: 0, artifactId: hiddenArt.id });
    assert.equal(
      await openReplaySession(fx.db, { flowId: hiddenFlow.id, actorId: fx.outsider.id, consent: "explicit" }),
      null,
    );
    const session = await openReplaySession(fx.db, { flowId: fx.flow.id, actorId: fx.owner.id, consent: "explicit" });
    assert.ok(session !== null);
    assert.equal(await recordReplayEvents(fx.db, { sessionId: session.id, actorId: fx.outsider.id, events: [META()] }), null);
    assert.equal(await getReplayEvents(fx.db, { sessionId: session.id, actorId: fx.outsider.id }), null);
    assert.equal(await closeReplaySession(fx.db, { sessionId: session.id, actorId: fx.outsider.id }), null);
    assert.equal(await getReplayEvents(fx.db, { sessionId: "00000000-0000-7000-8000-000000000000", actorId: fx.owner.id }), null);
  } finally {
    await fx.db.close();
  }
});
