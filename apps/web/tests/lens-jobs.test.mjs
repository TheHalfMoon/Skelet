import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { advanceKitRun, expireKitRun } from "../../../packages/db/src/build-kit.ts";
import {
  cancelLensJobRoute,
  createLensJobRoute,
  downloadLensArtifactRoute,
  getLensJobRoute,
  lensUriFor,
  parseLensUri,
  pollLensJobRoute,
  resumeLensJobRoute,
  retryLensJobRoute,
} from "../lib/lens-jobs.ts";

const BASE = new Date("2026-10-12T08:00:00.000Z");
const HEX64 = /^[0-9a-f]{64}$/;
let seq = 0;

function body(overrides = {}) {
  seq += 1;
  return {
    workspaceId: "00000000-0000-4000-8000-000000000000",
    sourceUrl: "https://example.org/",
    mode: "single-page",
    maxPages: 1,
    maxDepth: 0,
    maxBytes: 1048576,
    timeBudgetMs: 60000,
    idempotencyKey: `lens-rest-${Date.now()}-${seq}`,
    ...overrides,
  };
}

async function fixture(tag) {
  seq += 1;
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: `lens-${tag}-${seq}@skelet.example`, password: "lens-member-01" });
  const outsider = await signUp(db, { email: `lens-out-${tag}-${seq}@skelet.example`, password: "lens-member-01" });
  const space = await createWorkspace(db, { name: `Lens ${tag} ${seq}`, ownerId: owner.id });
  return { db, owner, outsider, workspaceId: space.workspace.id };
}

async function created(db, owner, workspaceId, overrides = {}) {
  const input = body({ workspaceId, ...overrides });
  const result = await createLensJobRoute(db, input, owner.id, `req-${seq}`);
  assert.equal(result.status, 201);
  return { input, job: result.body.result.job };
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("stable lens URI parses and round-trips", () => {
  const kitId = "a".repeat(64);
  assert.equal(lensUriFor(kitId), `skelet://lens/${kitId}`);
  assert.equal(parseLensUri(`skelet://lens/${kitId}`), kitId);
  assert.throws(() => parseLensUri("skelet://artifact/123"), { name: "AgentContractError" });
  assert.throws(() => parseLensUri("skelet://lens/short"), { name: "AgentContractError" });
  assert.throws(() => parseLensUri("https://example.org/"), { name: "AgentContractError" });
  assert.throws(() => parseLensUri(null), { name: "AgentContractError" });
});

test("create assigns a durable identifier and replays idempotently", async () => {
  const fx = await fixture("create");
  try {
    const input = body({ workspaceId: fx.workspaceId });
    const first = await createLensJobRoute(fx.db, input, fx.owner.id, "req-create-1");
    assert.equal(first.status, 201);
    assert.equal(first.body.schema_version, "skelet.agent.v1");
    assert.equal(first.body.request_id, "req-create-1");
    const job = first.body.result.job;
    assert.ok(HEX64.test(job.kitId));
    assert.ok(HEX64.test(job.analysisId));
    assert.equal(job.uri, lensUriFor(job.kitId));
    assert.equal(job.status, "queued");
    assert.equal(job.revision, 0);
    assert.equal(first.body.result.created, true);
    const replay = await createLensJobRoute(fx.db, input, fx.owner.id, "req-create-2");
    assert.equal(replay.status, 200);
    assert.equal(replay.body.result.created, false);
    assert.equal(replay.body.result.job.kitId, job.kitId);
    assert.equal(replay.body.result.job.uri, job.uri);
    const conflict = await createLensJobRoute(
      fx.db,
      { ...input, sourceUrl: "https://example.org/other" },
      fx.owner.id,
    );
    assert.equal(conflict.status, 400);
    assert.equal(conflict.body.error.code, "INVALID_INPUT");
  } finally {
    await fx.db.close();
  }
});

test("create validates shape without leaking internals", async () => {
  const fx = await fixture("validate");
  try {
    const cases = [
      [null, 400],
      [{ ...body({ workspaceId: fx.workspaceId }), extra: 1 }, 400],
      [body({ workspaceId: fx.workspaceId, sourceUrl: "http://example.org/" }), 400],
      [body({ workspaceId: fx.workspaceId, mode: "whole-internet" }), 400],
      [body({ workspaceId: fx.workspaceId, maxPages: "many" }), 400],
      [body({ workspaceId: fx.workspaceId, viewports: ["vr"] }), 400],
      [body({ workspaceId: fx.workspaceId, idempotencyKey: "has space" }), 400],
      [body({ workspaceId: fx.workspaceId, idempotencyKey: "" }), 400],
      [body({ workspaceId: fx.workspaceId, idempotencyKey: "k".repeat(129) }), 400],
      [body({ workspaceId: fx.workspaceId, pages: ["not-a-url", 7] }), 400],
    ];
    for (const [payload, status] of cases) {
      const result = await createLensJobRoute(fx.db, payload, fx.owner.id);
      assert.equal(result.status, status);
      assert.equal(result.body.error.code, "INVALID_INPUT");
    }
    // Unknown workspace answers 404, never 403-oracle detail.
    const foreign = await createLensJobRoute(
      fx.db,
      body({ workspaceId: "11111111-1111-4111-8111-111111111111" }),
      fx.owner.id,
    );
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.error.code, "FORBIDDEN_OR_NOT_FOUND");
    // Malformed identifiers answer alike.
    for (const bad of ["nope", "00000000-0000-0000-0000-000000000000"]) {
      const denied = await pollLensJobRoute(
        fx.db,
        { workspaceId: fx.workspaceId, kitId: bad },
        fx.owner.id,
      );
      assert.equal(denied.status, 404);
    }
    const badActor = await pollLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: "b".repeat(64) },
      "not-a-uuid",
    );
    assert.equal(badActor.status, 404);
  } finally {
    await fx.db.close();
  }
});

test("poll follows queued to terminal states with persisted evidence", async () => {
  const fx = await fixture("poll");
  try {
    const { job } = await created(fx.db, fx.owner, fx.workspaceId);
    const seen = [];
    const poll = async () => {
      const result = await pollLensJobRoute(
        fx.db,
        { workspaceId: fx.workspaceId, kitId: job.kitId },
        fx.owner.id,
      );
      assert.equal(result.status, 200);
      seen.push(result.body.result.job.status);
      return result.body.result.job;
    };
    assert.equal((await poll()).status, "queued");
    let revision = 0;
    for (const next of ["capturing", "extracting", "generating", "validating"]) {
      const advanced = await advanceKitRun(fx.db, {
        workspaceId: fx.workspaceId,
        kitId: job.kitId,
        workerId: "worker-rest-1",
        expectedRevision: revision,
        next,
      });
      revision = advanced.run.revision;
      assert.equal((await poll()).status, next);
    }
    const evidence = { analysis_id: job.analysisId, checks: ["schema"] };
    const manifest = {
      entries: [{ path: "manifest.json", sha256: "c".repeat(64), bytes: 120 }],
      withheld: [],
    };
    const done = await advanceKitRun(fx.db, {
      workspaceId: fx.workspaceId,
      kitId: job.kitId,
      workerId: "worker-rest-1",
      expectedRevision: revision,
      next: "completed",
      options: { evidence, artifactManifest: manifest },
    });
    assert.equal(done.run.status, "completed");
    const final = await poll();
    assert.equal(final.status, "completed");
    assert.deepEqual(seen, ["queued", "capturing", "extracting", "generating", "validating", "completed"]);
    const inspect = await getLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(inspect.status, 200);
    const detail = inspect.body.result.job;
    assert.equal(detail.sourceUrl, "https://example.org/");
    assert.deepEqual(detail.scope, {
      mode: "single-page",
      maxPages: 1,
      maxDepth: 0,
      maxBytes: 1048576,
      timeBudgetMs: 60000,
    });
    assert.deepEqual(detail.resultEvidence, evidence);
    assert.deepEqual(detail.artifactSummary, { entries: manifest.entries, withheld: [] });
    assert.ok(detail.createdAt.length > 0 && detail.finishedAt.length > 0);
  } finally {
    await fx.db.close();
  }
});

test("tenant isolation denies cross-workspace access alike", async () => {
  const fx = await fixture("tenant");
  try {
    const { job } = await created(fx.db, fx.owner, fx.workspaceId);
    for (const call of [
      () => pollLensJobRoute(fx.db, { workspaceId: fx.workspaceId, kitId: job.kitId }, fx.outsider.id),
      () => getLensJobRoute(fx.db, { workspaceId: fx.workspaceId, kitId: job.kitId }, fx.outsider.id),
      () => cancelLensJobRoute(fx.db, { workspaceId: fx.workspaceId, kitId: job.kitId }, fx.outsider.id),
      () => retryLensJobRoute(fx.db, { workspaceId: fx.workspaceId, kitId: job.kitId }, fx.outsider.id),
      () => downloadLensArtifactRoute(fx.db, { workspaceId: fx.workspaceId, kitId: job.kitId }, fx.outsider.id),
      () => createLensJobRoute(fx.db, body({ workspaceId: fx.workspaceId }), fx.outsider.id),
    ]) {
      const result = await call();
      assert.equal(result.status, 404);
      assert.equal(result.body.error.code, "FORBIDDEN_OR_NOT_FOUND");
    }
  } finally {
    await fx.db.close();
  }
});

test("concurrent quota is enforced deterministically then released", async () => {
  const fx = await fixture("quota");
  try {
    const first = await created(fx.db, fx.owner, fx.workspaceId);
    const second = await created(fx.db, fx.owner, fx.workspaceId);
    assert.notEqual(first.job.kitId, second.job.kitId);
    const third = await createLensJobRoute(fx.db, body({ workspaceId: fx.workspaceId }), fx.owner.id);
    assert.equal(third.status, 429);
    assert.equal(third.body.error.code, "QUOTA_EXCEEDED");
    const canceled = await cancelLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: first.job.kitId },
      fx.owner.id,
    );
    assert.equal(canceled.status, 200);
    assert.equal(canceled.body.result.applied, true);
    const retry = await createLensJobRoute(fx.db, body({ workspaceId: fx.workspaceId }), fx.owner.id);
    assert.equal(retry.status, 201);
  } finally {
    await fx.db.close();
  }
});

test("cancel is deterministic and rejects terminal runs", async () => {
  const fx = await fixture("cancel");
  try {
    const { job } = await created(fx.db, fx.owner, fx.workspaceId);
    const first = await cancelLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(first.body.result.job.status, "canceled");
    assert.equal(first.body.result.applied, true);
    const again = await cancelLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(again.body.result.job.status, "canceled");
    assert.equal(again.body.result.applied, false);
    const retryOnCanceled = await retryLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(retryOnCanceled.status, 409);
    assert.equal(retryOnCanceled.body.error.code, "NOT_AVAILABLE");
    // Terminal completed runs are not cancelable: drive a second job there.
    const other = await created(fx.db, fx.owner, fx.workspaceId, { maxPages: 2 });
    await cancelLensJobRoute(fx.db, { workspaceId: fx.workspaceId, kitId: other.job.kitId }, fx.owner.id);
    const done = await created(fx.db, fx.owner, fx.workspaceId, { maxPages: 3 });
    let revision = 0;
    for (const next of ["capturing", "extracting", "generating", "validating"]) {
      const advanced = await advanceKitRun(fx.db, {
        workspaceId: fx.workspaceId,
        kitId: done.job.kitId,
        workerId: "worker-cancel",
        expectedRevision: revision,
        next,
      });
      revision = advanced.run.revision;
    }
    await advanceKitRun(fx.db, {
      workspaceId: fx.workspaceId,
      kitId: done.job.kitId,
      workerId: "worker-cancel",
      expectedRevision: revision,
      next: "completed",
      options: { evidence: { ok: true }, artifactManifest: { entries: [] } },
    });
    const cancelDone = await cancelLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: done.job.kitId },
      fx.owner.id,
    );
    assert.equal(cancelDone.status, 409);
  } finally {
    await fx.db.close();
  }
});

test("retry requeues within budget and preserves attempt history", async () => {
  const fx = await fixture("retry");
  try {
    const { job } = await created(fx.db, fx.owner, fx.workspaceId, { maxAttempts: 1 });
    const early = await retryLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(early.status, 409);
    await advanceKitRun(fx.db, {
      workspaceId: fx.workspaceId,
      kitId: job.kitId,
      workerId: "worker-retry",
      expectedRevision: 0,
      next: "capturing",
    });
    const failed = await advanceKitRun(fx.db, {
      workspaceId: fx.workspaceId,
      kitId: job.kitId,
      workerId: "worker-retry",
      expectedRevision: 1,
      next: "failed",
      options: { errorClass: "lens/capture" },
    });
    assert.equal(failed.run.errorClass, "lens/capture");
    const retried = await retryLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(retried.status, 200);
    assert.equal(retried.body.result.job.status, "queued");
    assert.equal(retried.body.result.job.attempt, 1);
    const inspect = await getLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(inspect.body.result.job.attemptHistory.length, 1);
    assert.equal(inspect.body.result.job.attemptHistory[0].errorClass, "lens/capture");
    // Budget exhausted: fail again, then retry is rejected without recharge.
    await advanceKitRun(fx.db, {
      workspaceId: fx.workspaceId,
      kitId: job.kitId,
      workerId: "worker-retry",
      expectedRevision: inspect.body.result.job.revision,
      next: "capturing",
    });
    const polled = await pollLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    await advanceKitRun(fx.db, {
      workspaceId: fx.workspaceId,
      kitId: job.kitId,
      workerId: "worker-retry",
      expectedRevision: polled.body.result.job.revision,
      next: "failed",
      options: { errorClass: "lens/capture" },
    });
    const exhausted = await retryLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(exhausted.status, 409);
    // Failed runs stay inspectable as data, never 500.
    const failedView = await pollLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(failedView.status, 200);
    assert.equal(failedView.body.result.job.status, "failed");
    assert.equal(failedView.body.result.job.errorClass, "lens/capture");
  } finally {
    await fx.db.close();
  }
});

test("resume transfers the lease only after expiry or checkpoint", async () => {
  const fx = await fixture("resume");
  try {
    const { job } = await created(fx.db, fx.owner, fx.workspaceId);
    const queuedResume = await resumeLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(queuedResume.status, 409);
    const badWorker = await resumeLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId, workerId: "  " },
      fx.owner.id,
    );
    assert.equal(badWorker.status, 400);
    const claimed = await advanceKitRun(fx.db, {
      workspaceId: fx.workspaceId,
      kitId: job.kitId,
      workerId: "worker-a",
      expectedRevision: 0,
      next: "capturing",
    });
    const checkpointed = await advanceKitRun(fx.db, {
      workspaceId: fx.workspaceId,
      kitId: job.kitId,
      workerId: "worker-a",
      expectedRevision: claimed.run.revision,
      next: "capturing",
      options: {
        checkpoint: {
          state: "capturing",
          requestHash: claimed.run.requestHash,
          cursor: { page: 0 },
        },
      },
    });
    void checkpointed;
    // Live lease held by another worker: resume refuses without waiting.
    const held = await resumeLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId, workerId: "worker-b" },
      fx.owner.id,
      undefined,
    );
    assert.equal(held.status, 409);
    assert.equal(held.body.error.code, "NOT_AVAILABLE");
  } finally {
    await fx.db.close();
  }
});

test("download serves persisted artifacts with integrity and denies the rest", async () => {
  const fx = await fixture("download");
  try {
    const { job } = await created(fx.db, fx.owner, fx.workspaceId);
    const active = await downloadLensArtifactRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(active.status, 409);
    const badName = await downloadLensArtifactRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId, name: "kit.zip" },
      fx.owner.id,
    );
    assert.equal(badName.status, 400);
    let revision = 0;
    for (const next of ["capturing", "extracting", "generating", "validating"]) {
      const advanced = await advanceKitRun(fx.db, {
        workspaceId: fx.workspaceId,
        kitId: job.kitId,
        workerId: "worker-dl",
        expectedRevision: revision,
        next,
      });
      revision = advanced.run.revision;
    }
    const secretContent = "super-secret-bytes-that-must-never-ship";
    const evidence = { analysis_id: job.analysisId, coverage_gaps: [] };
    const manifest = {
      entries: [{ path: "manifest.json", sha256: "d".repeat(64), bytes: 140 }],
      withheld: ["secret.bin"],
    };
    await advanceKitRun(fx.db, {
      workspaceId: fx.workspaceId,
      kitId: job.kitId,
      workerId: "worker-dl",
      expectedRevision: revision,
      next: "completed",
      options: { evidence, artifactManifest: manifest },
    });
    const served = await downloadLensArtifactRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(served.status, 200);
    assert.ok(served.file);
    assert.equal(served.file.mediaType, "application/json");
    assert.ok(served.file.filename.endsWith("-manifest.json"));
    assert.equal(served.file.sha256, sha256Bytes(served.file.bytes));
    const text = new TextDecoder().decode(served.file.bytes);
    assert.ok(text.includes("secret.bin"));
    assert.ok(!text.includes(secretContent));
    const evidenceServed = await downloadLensArtifactRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId, name: "evidence.json" },
      fx.owner.id,
    );
    assert.equal(evidenceServed.status, 200);
    assert.ok(evidenceServed.file);
    assert.equal(evidenceServed.file.sha256, sha256Bytes(evidenceServed.file.bytes));
    // Purged outputs answer 404 like unknown identities.
    await expireKitRun(
      fx.db,
      {
        workspaceId: fx.workspaceId,
        actorId: fx.owner.id,
        kitId: job.kitId,
        now: new Date(BASE.getTime() + 31 * 86400000),
      },
    );
    const purged = await downloadLensArtifactRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(purged.status, 404);
    const purgedPoll = await pollLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(purgedPoll.body.result.job.purged, true);
    assert.equal(purgedPoll.body.result.job.status, "completed");
  } finally {
    await fx.db.close();
  }
});

test("lens layer introduces no model provider dependency", async () => {
  const source = await readFile(new URL("../lib/lens-jobs.ts", import.meta.url), "utf8");
  for (const forbidden of ["packages/providers", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "fetch("]) {
    assert.ok(!source.includes(forbidden), `lens-jobs must not reference ${forbidden}`);
  }
});
