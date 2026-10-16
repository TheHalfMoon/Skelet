import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { advanceKitRun, getKitRun } from "../../../packages/db/src/build-kit.ts";
import {
  createLensJobRoute,
  getLensJobRoute,
  pollLensJobRoute,
  resumeLensJobRoute,
} from "../lib/lens-jobs.ts";

let seq = 0;

async function memberDb(db) {
  seq += 1;
  const owner = await signUp(db, { email: `lensrec-${Date.now()}-${seq}@skilit.example`, password: "lens-member-01" });
  const space = await createWorkspace(db, { name: `Lens recovery ${seq}`, ownerId: owner.id });
  return { owner, workspaceId: space.workspace.id };
}

function createBody(workspaceId, overrides = {}) {
  seq += 1;
  return {
    workspaceId,
    sourceUrl: "https://example.org/",
    mode: "single-page",
    maxPages: 1,
    maxDepth: 0,
    maxBytes: 1048576,
    timeBudgetMs: 60000,
    idempotencyKey: `lens-recovery-${Date.now()}-${seq}`,
    ...overrides,
  };
}

test("resume transfers an expired lease to a recovering worker", async () => {
  const db = await openDatabase();
  try {
    await migrateUp(db);
    const { owner, workspaceId } = await memberDb(db);
    const created = await createLensJobRoute(db, createBody(workspaceId), owner.id);
    const kitId = created.body.result.job.kitId;
    const run = await getKitRun(db, { workspaceId, actorId: owner.id, kitId });
    const past = new Date(Date.now() - 600000);
    await advanceKitRun(db, {
      workspaceId,
      kitId,
      workerId: "worker-crashed",
      expectedRevision: 0,
      next: "capturing",
      options: {
        checkpoint: { state: "capturing", requestHash: run.requestHash, cursor: { page: 0 } },
        now: past,
      },
    });
    // Worker A claims the run in the past with a valid checkpoint, then
    // "crashes" (no heartbeat). The 300s lease expired minutes ago, so a
    // recovering worker takes over through the same route the UI/REST/MCP
    // recovery buttons serve.
    const resumed = await resumeLensJobRoute(db, { workspaceId, kitId, workerId: "worker-recovery" }, owner.id);
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.result.resumed, true);
    assert.equal(resumed.body.result.job.status, "capturing");
    const inspect = await getLensJobRoute(db, { workspaceId, kitId }, owner.id);
    assert.equal(inspect.body.result.job.revision, resumed.body.result.job.revision);
  } finally {
    await db.close();
  }
});

test("durable state survives close and reopen on a file-backed store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skilit-lens-persist-"));
  let kitId = "";
  let analysisId = "";
  try {
    const first = await openDatabase({ dataDir: dir });
    try {
      await migrateUp(first);
      const { owner, workspaceId } = await memberDb(first);
      const created = await createLensJobRoute(
        first,
        { ...createBody(workspaceId), workspaceId },
        owner.id,
      );
      assert.equal(created.status, 201);
      kitId = created.body.result.job.kitId;
      analysisId = created.body.result.job.analysisId;
      const ownerId = owner.id;
      const ws = workspaceId;
      await first.close();
      const second = await openDatabase({ dataDir: dir });
      try {
        await migrateUp(second);
        const polled = await pollLensJobRoute(second, { workspaceId: ws, kitId }, ownerId);
        assert.equal(polled.status, 200);
        assert.equal(polled.body.result.job.kitId, kitId);
        assert.equal(polled.body.result.job.analysisId, analysisId);
        assert.equal(polled.body.result.job.status, "queued");
        assert.equal(polled.body.result.job.uri, `skilit://lens/${kitId}`);
        const detail = await getLensJobRoute(second, { workspaceId: ws, kitId }, ownerId);
        assert.equal(detail.status, 200);
        assert.equal(detail.body.result.job.sourceUrl, "https://example.org/");
      } finally {
        await second.close();
      }
    } catch (error) {
      try {
        await first.close();
      } catch {
        // Close is best effort when the body already failed.
      }
      throw error;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
