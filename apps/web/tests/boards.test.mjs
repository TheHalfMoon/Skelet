import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { addMember, createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { createProduct, createProductVersion, createSource } from "../../../packages/db/src/repositories.ts";
import { createArtifact } from "../../../packages/db/src/graph.ts";

async function createSourceFor(db) {
  return createSource(db, { key: `board-launder-${Date.now()}-${seq}`, kind: "synthetic" });
}

async function createProductFor(db, sourceId) {
  return createProduct(db, { sourceId, title: "Board app" });
}

async function createProductVersionFor(db, productId) {
  return createProductVersion(db, { productId, versionNo: 1 });
}
import {
  createBoardRoute,
  deleteBoardRoute,
  getBoardRoute,
  handOffBoardRoute,
  listBoardHandoffsRoute,
  listBoardsRoute,
  moveBoardItemRoute,
  removeBoardItemRoute,
  saveBoardItemRoute,
  updateBoardRoute,
  validateBoardItemsRoute,
} from "../lib/boards.ts";

let seq = 0;

async function fixture(tag) {
  seq += 1;
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: `board-${tag}-${seq}@skelet.example`, password: "board-member-01" });
  const fellow = await signUp(db, { email: `board-fellow-${tag}-${seq}@skelet.example`, password: "board-member-01" });
  const outsider = await signUp(db, { email: `board-out-${tag}-${seq}@skelet.example`, password: "board-member-01" });
  const space = await createWorkspace(db, { name: `Board ${tag} ${seq}`, ownerId: owner.id });
  await addMember(db, { workspaceId: space.workspace.id, userId: fellow.id, role: "member", actorId: owner.id });
  return { db, owner, fellow, outsider, workspaceId: space.workspace.id };
}

async function screen(db, workspaceId, ownerId, index) {
  const source = await createSource(db, { key: `board-screen-${Date.now()}-${seq}-${index}`, kind: "synthetic" });
  const product = await createProduct(db, { sourceId: source.id, title: "Board app" });
  const version = await createProductVersion(db, { productId: product.id, versionNo: 1 });
  return createArtifact(db, {
    sourceId: source.id,
    productId: product.id,
    productVersionId: version.id,
    kind: "screen",
    title: `Board screen ${index}`,
    contentHash: `${index}`.repeat(64).slice(0, 64),
    rightsClassification: "metadata_only",
    visibility: "workspace",
    workspaceId,
    ownerSubject: ownerId,
  });
}

async function board(db, owner, workspaceId, overrides = {}) {
  const result = await createBoardRoute(
    db,
    { workspaceId, title: "Moodboard", visibility: "workspace", ...overrides },
    owner.id,
  );
  assert.equal(result.status, 201);
  return result.body.result.board;
}

test("board lifecycle returns stable URIs with ordered items", async () => {
  const fx = await fixture("lifecycle");
  try {
    const created = await board(fx.db, fx.owner, fx.workspaceId);
    assert.ok(created.uri.startsWith("skelet://collection/"));
    assert.equal(created.title, "Moodboard");
    const listed = await listBoardsRoute(fx.db, { workspaceId: fx.workspaceId }, fx.owner.id);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.result.boards.map((entry) => entry.id), [created.id]);
    const first = await screen(fx.db, fx.workspaceId, fx.owner.id, 1);
    const second = await screen(fx.db, fx.workspaceId, fx.owner.id, 2);
    const savedFirst = await saveBoardItemRoute(
      fx.db, created.id, { workspaceId: fx.workspaceId, artifactId: first.id }, fx.owner.id,
    );
    assert.equal(savedFirst.status, 200);
    assert.equal(savedFirst.body.result.item.position, 0);
    const savedSecond = await saveBoardItemRoute(
      fx.db, created.id, { workspaceId: fx.workspaceId, artifactId: second.id }, fx.fellow.id,
    );
    assert.equal(savedSecond.body.result.item.position, 1);
    const fetched = await getBoardRoute(fx.db, { boardId: created.id }, fx.fellow.id);
    assert.equal(fetched.status, 200);
    assert.deepEqual(fetched.body.result.items.map((entry) => entry.artifactId), [first.id, second.id]);
    assert.deepEqual(fetched.body.result.items.map((entry) => entry.position), [0, 1]);
    assert.ok(fetched.body.result.items.every((entry) => entry.uri.startsWith("skelet://artifact/")));
    const moved = await moveBoardItemRoute(
      fx.db, created.id, { workspaceId: fx.workspaceId, artifactId: first.id, toPosition: 1 }, fx.owner.id,
    );
    assert.equal(moved.status, 200);
    assert.deepEqual(moved.body.result.items.map((entry) => entry.artifactId), [second.id, first.id]);
    const removed = await removeBoardItemRoute(
      fx.db, { boardId: created.id, artifactId: second.id }, fx.owner.id,
    );
    assert.equal(removed.body.result.removed, true);
    assert.deepEqual(removed.body.result.items.map((entry) => entry.position), [0]);
    const deleted = await deleteBoardRoute(fx.db, created.id, fx.owner.id);
    assert.equal(deleted.body.result.deleted, true);
    const gone = await getBoardRoute(fx.db, { boardId: created.id }, fx.owner.id);
    assert.equal(gone.status, 404);
    assert.equal(gone.body.error.code, "FORBIDDEN_OR_NOT_FOUND");
  } finally {
    await fx.db.close();
  }
});

test("board validation fails closed without leaking internals", async () => {
  const fx = await fixture("validate");
  try {
    const cases = [
      () => createBoardRoute(fx.db, null, fx.owner.id),
      () => createBoardRoute(fx.db, { workspaceId: fx.workspaceId, title: "Board", extra: 1 }, fx.owner.id),
      () => createBoardRoute(fx.db, { workspaceId: fx.workspaceId, title: "  " }, fx.owner.id),
      () => createBoardRoute(fx.db, { workspaceId: fx.workspaceId, title: "Board", visibility: "public" }, fx.owner.id),
      () => updateBoardRoute(fx.db, "not-a-uuid", { title: "x" }, fx.owner.id),
      () => moveBoardItemRoute(fx.db, "not-a-uuid", { workspaceId: fx.workspaceId }, fx.owner.id),
      () => removeBoardItemRoute(fx.db, { boardId: "not-a-uuid", artifactId: "also-bad" }, fx.owner.id),
    ];
    for (const [index, call] of cases.entries()) {
      const result = await call();
      assert.ok([400, 404].includes(result.status), `case ${index}`);
      assert.equal(result.body.schema_version, "skelet.agent.v1", `case ${index}`);
    }
    const created = await board(fx.db, fx.owner, fx.workspaceId);
    const emptyUpdate = await updateBoardRoute(fx.db, created.id, {}, fx.owner.id);
    assert.equal(emptyUpdate.status, 400);
    assert.equal(emptyUpdate.body.error.code, "INVALID_INPUT");
    const renamed = await updateBoardRoute(fx.db, created.id, { title: "Renamed" }, fx.owner.id);
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.result.board.title, "Renamed");
    // Visibility changes stay with the owner alone.
    const fellowVisibility = await updateBoardRoute(fx.db, created.id, { visibility: "private" }, fx.fellow.id);
    assert.equal(fellowVisibility.status, 404);
    const ownerVisibility = await updateBoardRoute(fx.db, created.id, { visibility: "private" }, fx.owner.id);
    assert.equal(ownerVisibility.body.result.board.visibility, "private");
    const badActor = await listBoardsRoute(fx.db, { workspaceId: fx.workspaceId }, "not-a-uuid");
    assert.equal(badActor.status, 404);
  } finally {
    await fx.db.close();
  }
});

test("board tenant isolation denies cross-workspace access alike", async () => {
  const fx = await fixture("tenant");
  try {
    const created = await board(fx.db, fx.owner, fx.workspaceId);
    const first = await screen(fx.db, fx.workspaceId, fx.owner.id, 1);
    for (const call of [
      () => getBoardRoute(fx.db, { boardId: created.id }, fx.outsider.id),
      () => updateBoardRoute(fx.db, created.id, { title: "Hijacked" }, fx.outsider.id),
      () => deleteBoardRoute(fx.db, created.id, fx.outsider.id),
      () => saveBoardItemRoute(fx.db, created.id, { workspaceId: fx.workspaceId, artifactId: first.id }, fx.outsider.id),
      () => moveBoardItemRoute(fx.db, created.id, { workspaceId: fx.workspaceId, artifactId: first.id, toPosition: 0 }, fx.outsider.id),
      () => createBoardRoute(fx.db, { workspaceId: fx.workspaceId, title: "Squatter" }, fx.outsider.id),
      () => listBoardsRoute(fx.db, { workspaceId: fx.workspaceId }, fx.outsider.id),
    ]) {
      const result = await call();
      assert.equal(result.status, 404);
      assert.equal(result.body.error.code, "FORBIDDEN_OR_NOT_FOUND");
    }
    // Workspace locator aliasing is rejected: the board lives in the
    // fixture workspace, not in a foreign one.
    const foreign = await createWorkspace(fx.db, { name: "Foreign", ownerId: fx.outsider.id });
    const aliased = await saveBoardItemRoute(
      fx.db, created.id, { workspaceId: foreign.workspace.id, artifactId: first.id }, fx.owner.id,
    );
    assert.equal(aliased.status, 404);
    // Laundering guard: a member cannot save a private artifact they cannot read.
    const source = await createSourceFor(fx.db);
    const product = await createProductFor(fx.db, source.id);
    const version = await createProductVersionFor(fx.db, product.id);
    const priv = await createArtifact(fx.db, {
      sourceId: source.id,
      productId: product.id,
      productVersionId: version.id,
      kind: "screen",
      title: "Private screen",
      contentHash: "d".repeat(64),
      rightsClassification: "metadata_only",
      visibility: "private",
      workspaceId: fx.workspaceId,
      ownerSubject: fx.owner.id,
    });
    const laundered = await saveBoardItemRoute(
      fx.db, created.id, { workspaceId: fx.workspaceId, artifactId: priv.id }, fx.fellow.id,
    );
    assert.equal(laundered.status, 404);
    assert.equal(laundered.body.error.code, "FORBIDDEN_OR_NOT_FOUND");
  } finally {
    await fx.db.close();
  }
});

test("board handoff transfers ownership with ledger proof and validation", async () => {
  const fx = await fixture("handoff");
  try {
    const created = await board(fx.db, fx.owner, fx.workspaceId);
    const first = await screen(fx.db, fx.workspaceId, fx.owner.id, 1);
    const saved = await saveBoardItemRoute(
      fx.db, created.id, { workspaceId: fx.workspaceId, artifactId: first.id }, fx.owner.id,
    );
    assert.equal(saved.status, 200);
    const validated = await validateBoardItemsRoute(fx.db, { boardId: created.id }, fx.owner.id);
    assert.equal(validated.status, 200);
    assert.equal(validated.body.result.items.length, 1);
    assert.equal(validated.body.result.items[0].status, "ok");
    assert.equal(validated.body.result.summary.ok, 1);
    assert.ok(validated.body.result.board.uri.startsWith("skelet://collection/"));
    const handed = await handOffBoardRoute(
      fx.db, created.id, { workspaceId: fx.workspaceId, toSubjectId: fx.fellow.id }, fx.owner.id,
    );
    assert.equal(handed.status, 200);
    assert.ok(handed.body.result.handoff.boardUri.startsWith("skelet://collection/"));
    assert.equal(handed.body.result.handoff.fromSubject, fx.owner.id);
    assert.equal(handed.body.result.handoff.toSubject, fx.fellow.id);
    assert.equal(handed.body.result.board.id, created.id);
    const chain = await listBoardHandoffsRoute(fx.db, { boardId: created.id }, fx.fellow.id);
    assert.equal(chain.status, 200);
    assert.equal(chain.body.result.handoffs.length, 1);
    assert.equal(chain.body.result.handoffs[0].id, handed.body.result.handoff.id);
    // Workspace-visible boards stay readable to all members after handoff;
    // ownership (not readability) moves: the old owner can still validate
    // but can no longer hand the board off again.
    const fellowView = await validateBoardItemsRoute(fx.db, { boardId: created.id }, fx.fellow.id);
    assert.equal(fellowView.status, 200);
    const ownerView = await validateBoardItemsRoute(fx.db, { boardId: created.id }, fx.owner.id);
    assert.equal(ownerView.status, 200);
    const ownerRehandoff = await handOffBoardRoute(
      fx.db, created.id, { workspaceId: fx.workspaceId, toSubjectId: fx.owner.id }, fx.owner.id,
    );
    assert.equal(ownerRehandoff.status, 404);
    assert.equal(ownerRehandoff.body.error.code, "FORBIDDEN_OR_NOT_FOUND");
  } finally {
    await fx.db.close();
  }
});

test("board handoff fails closed on authority, recipient, and locator abuse", async () => {
  const fx = await fixture("handoff-deny");
  try {
    const created = await board(fx.db, fx.owner, fx.workspaceId);
    // Non-owner cannot hand off.
    const fellowHandoff = await handOffBoardRoute(
      fx.db, created.id, { workspaceId: fx.workspaceId, toSubjectId: fx.outsider.id }, fx.fellow.id,
    );
    assert.equal(fellowHandoff.status, 404);
    assert.equal(fellowHandoff.body.error.code, "FORBIDDEN_OR_NOT_FOUND");
    // Outsider cannot hand off, list, or validate.
    for (const call of [
      () => handOffBoardRoute(fx.db, created.id, { workspaceId: fx.workspaceId, toSubjectId: fx.fellow.id }, fx.outsider.id),
      () => listBoardHandoffsRoute(fx.db, { boardId: created.id }, fx.outsider.id),
      () => validateBoardItemsRoute(fx.db, { boardId: created.id }, fx.outsider.id),
    ]) {
      const result = await call();
      assert.equal(result.status, 404);
      assert.equal(result.body.error.code, "FORBIDDEN_OR_NOT_FOUND");
    }
    // Recipient must be a workspace member: outsider and self fail closed.
    const outsiderRecipient = await handOffBoardRoute(
      fx.db, created.id, { workspaceId: fx.workspaceId, toSubjectId: fx.outsider.id }, fx.owner.id,
    );
    assert.equal(outsiderRecipient.status, 404);
    const selfRecipient = await handOffBoardRoute(
      fx.db, created.id, { workspaceId: fx.workspaceId, toSubjectId: fx.owner.id }, fx.owner.id,
    );
    assert.equal(selfRecipient.status, 400);
    assert.equal(selfRecipient.body.error.code, "INVALID_INPUT");
    // Workspace locator aliasing is rejected.
    const foreign = await createWorkspace(fx.db, { name: "Foreign handoff", ownerId: fx.outsider.id });
    const aliased = await handOffBoardRoute(
      fx.db, created.id, { workspaceId: foreign.workspace.id, toSubjectId: fx.fellow.id }, fx.owner.id,
    );
    assert.equal(aliased.status, 404);
    // Malformed identifiers and bodies fail closed without leaking internals.
    for (const call of [
      () => handOffBoardRoute(fx.db, "not-a-uuid", { workspaceId: fx.workspaceId, toSubjectId: fx.fellow.id }, fx.owner.id),
      () => handOffBoardRoute(fx.db, created.id, { workspaceId: "not-a-uuid", toSubjectId: fx.fellow.id }, fx.owner.id),
      () => handOffBoardRoute(fx.db, created.id, { workspaceId: fx.workspaceId, toSubjectId: "not-a-uuid" }, fx.owner.id),
      () => handOffBoardRoute(fx.db, created.id, { workspaceId: fx.workspaceId, toSubjectId: fx.fellow.id, extra: 1 }, fx.owner.id),
      () => handOffBoardRoute(fx.db, created.id, null, fx.owner.id),
      () => listBoardHandoffsRoute(fx.db, { boardId: "not-a-uuid" }, fx.owner.id),
      () => validateBoardItemsRoute(fx.db, { boardId: "not-a-uuid" }, fx.owner.id),
      () => listBoardHandoffsRoute(fx.db, { boardId: created.id }, "not-a-uuid"),
    ]) {
      const result = await call();
      assert.ok([400, 404].includes(result.status));
      assert.equal(result.body.schema_version, "skelet.agent.v1");
    }
  } finally {
    await fx.db.close();
  }
});

test("board layer introduces no model provider dependency", async () => {
  const source = await readFile(new URL("../lib/boards.ts", import.meta.url), "utf8");
  for (const forbidden of ["packages/providers", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "fetch("]) {
    assert.ok(!source.includes(forbidden), `boards must not reference ${forbidden}`);
  }
});
