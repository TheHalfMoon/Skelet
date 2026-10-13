import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/db.ts";
import { migrateDown, migrateUp } from "../src/migrate.ts";
import { AuthError, signUp } from "../src/auth.ts";
import { addMember, createWorkspace } from "../src/workspaces.ts";
import { createProduct, createProductVersion, createSource } from "../src/repositories.ts";
import { createArtifact } from "../src/graph.ts";
import {
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
  listReferences,
  moveReference,
  removeReference,
  saveReference,
  updateCollection,
} from "../src/collections.ts";

const SIX = [
  "001_sources_products",
  "002_design_graph",
  "003_workflows",
  "004_auth",
  "005_workspaces",
  "006_collections_auth",
  "007_billing",
  "008_jobs",
  "009_lens_build_kit_runs",
  "010_artifact_actor_scope", "011_pack_idempotency", "012_asset_search_fts", "013_lens_build_kit_purge", "014_collection_item_order",
];
const HASH = "c".repeat(64);

async function fixtureDb() {
  const db = await openDatabase();
  await migrateUp(db);
  return db;
}

async function member(db, index) {
  return signUp(db, {
    email: `collection-user-${index}@skelet.example`,
    password: "collection-password-01",
  });
}

async function workspaceWithOwner(db, index) {
  const owner = await member(db, `owner-${index}`);
  const created = await createWorkspace(db, { name: `Collection space ${index}`, ownerId: owner.id });
  return { owner, workspaceId: created.workspace.id };
}

async function artifactFixture(db, workspaceId, ownerId) {
  const source = await createSource(db, { key: "collection-source", kind: "synthetic" });
  const product = await createProduct(db, { sourceId: source.id, title: "Collection app" });
  const version = await createProductVersion(db, { productId: product.id, versionNo: 1 });
  // AF-SEC-00: workspace-visible artifact bound to the calling workspace so
  // workspace members can read it through the actor gate.
  return createArtifact(db, {
    sourceId: source.id,
    productId: product.id,
    productVersionId: version.id,
    kind: "screen",
    title: "Save target",
    contentHash: HASH,
    rightsClassification: "metadata_only",
    visibility: "workspace",
    workspaceId,
    ownerSubject: ownerId,
  });
}

test("006 migration binds collections to workspaces and reverses cleanly", async () => {
  const db = await openDatabase();
  try {
    assert.deepEqual(await migrateUp(db), SIX);
    const constraint = await db.query(
      `select conname from pg_constraint where conname = 'collections_workspace_fk'`,
    );
    assert.equal(constraint.rows.length, 1);
    await assert.rejects(
      () => db.query(
        `insert into collections (workspace_id, owner_subject, title)
         values ($1, 'orphan', 'Orphan')`,
        ["00000000-0000-0000-0000-000000000000"],
      ),
      /foreign key|violates/i,
    );
    assert.deepEqual(await migrateDown(db), [...SIX].reverse());
    assert.deepEqual(await migrateUp(db), SIX);
  } finally {
    await db.close();
  }
});

test("collection CRUD honors membership and visibility", async () => {
  const db = await fixtureDb();
  try {
    const { owner, workspaceId } = await workspaceWithOwner(db, "crud");
    const fellow = await member(db, "fellow-crud");
    const created = await createCollection(db, {
      workspaceId,
      title: "  Private research  ",
      actorId: owner.id,
    });
    assert.equal(created.title, "Private research");
    assert.equal(created.visibility, "private");
    assert.equal(created.ownerSubject, owner.id);
    assert.deepEqual((await getCollection(db, created.id, owner.id)).id, created.id);
    await assert.rejects(
      () => getCollection(db, created.id, fellow.id),
      (error) => error instanceof AuthError && error.code === "auth/forbidden",
    );
    await assert.rejects(
      () => createCollection(db, { workspaceId, title: "Intruder", actorId: fellow.id }),
      (error) => error instanceof AuthError && error.code === "auth/forbidden",
    );
    for (const title of ["", "   "]) {
      await assert.rejects(
        () => createCollection(db, { workspaceId, title, actorId: owner.id }),
        (error) => error instanceof AuthError && error.code === "auth/invalid-collection",
      );
    }
    await assert.rejects(
      () => createCollection(db, { workspaceId, title: "Bad", visibility: "public", actorId: owner.id }),
      (error) => error instanceof AuthError && error.code === "auth/invalid-collection",
    );
    const renamed = await updateCollection(db, {
      collectionId: created.id,
      title: "Shared research",
      visibility: "workspace",
      actorId: owner.id,
    });
    assert.equal(renamed.title, "Shared research");
    assert.equal(renamed.visibility, "workspace");
    await addMember(db, { workspaceId, userId: fellow.id, role: "member", actorId: owner.id });
    assert.deepEqual((await getCollection(db, created.id, fellow.id)).id, created.id);
    await assert.rejects(
      () => updateCollection(db, { collectionId: created.id, title: "Hijack", actorId: fellow.id }),
      (error) => error instanceof AuthError && error.code === "auth/forbidden",
    );
    await assert.rejects(
      () => deleteCollection(db, { collectionId: created.id, actorId: fellow.id }),
      (error) => error instanceof AuthError && error.code === "auth/forbidden",
    );
    await deleteCollection(db, { collectionId: created.id, actorId: owner.id });
    await assert.rejects(
      () => getCollection(db, created.id, owner.id),
      (error) => error instanceof AuthError && error.code === "auth/collection-not-found",
    );
    await assert.rejects(
      () => getCollection(db, "not-a-uuid", owner.id),
      (error) => error instanceof AuthError && error.code === "auth/collection-not-found",
    );
  } finally {
    await db.close();
  }
});

test("workspace admins manage collections they do not own", async () => {
  const db = await fixtureDb();
  try {
    const { owner, workspaceId } = await workspaceWithOwner(db, "admin");
    const admin = await member(db, "admin-user");
    await addMember(db, { workspaceId, userId: admin.id, role: "admin", actorId: owner.id });
    const created = await createCollection(db, {
      workspaceId,
      title: "Owner list",
      visibility: "workspace",
      actorId: owner.id,
    });
    const renamed = await updateCollection(db, {
      collectionId: created.id,
      title: "Admin renamed",
      actorId: admin.id,
    });
    assert.equal(renamed.title, "Admin renamed");
    await assert.rejects(
      () => updateCollection(db, { collectionId: created.id, visibility: "private", actorId: admin.id }),
      (error) => error instanceof AuthError && error.code === "auth/forbidden",
      "visibility changes stay with the owner alone",
    );
    await deleteCollection(db, { collectionId: created.id, actorId: admin.id });
    await assert.rejects(
      () => getCollection(db, created.id, owner.id),
      (error) => error instanceof AuthError && error.code === "auth/collection-not-found",
    );
  } finally {
    await db.close();
  }
});

test("save-reference path persists canonical artifacts idempotently", async () => {
  const db = await fixtureDb();
  try {
    const { owner, workspaceId } = await workspaceWithOwner(db, "refs");
    const fellow = await member(db, "fellow-refs");
    await addMember(db, { workspaceId, userId: fellow.id, role: "member", actorId: owner.id });
    const screen = await artifactFixture(db, workspaceId, owner.id);
    const collection = await createCollection(db, {
      workspaceId,
      title: "Evidence",
      visibility: "workspace",
      actorId: owner.id,
    });
    const first = await saveReference(db, {
      collectionId: collection.id,
      artifactId: screen.id,
      actorId: fellow.id,
    });
    assert.equal(first.artifactId, screen.id);
    const again = await saveReference(db, {
      collectionId: collection.id,
      artifactId: screen.id,
      actorId: fellow.id,
    });
    assert.equal(again.artifactId, screen.id);
    const refs = await listReferences(db, collection.id, owner.id);
    assert.deepEqual(refs.map((entry) => entry.artifactId), [screen.id]);
    await removeReference(db, { collectionId: collection.id, artifactId: screen.id, actorId: fellow.id });
    await removeReference(db, { collectionId: collection.id, artifactId: screen.id, actorId: fellow.id });
    assert.deepEqual(await listReferences(db, collection.id, owner.id), []);
    await assert.rejects(
      () => saveReference(db, { collectionId: collection.id, artifactId: "not-a-uuid", actorId: owner.id }),
      (error) => error instanceof AuthError && error.code === "auth/artifact-not-found",
    );
    await assert.rejects(
      () => saveReference(db, {
        collectionId: collection.id,
        artifactId: "11111111-2222-4333-8444-555555555555",
        actorId: owner.id,
      }),
      (error) => error instanceof AuthError && error.code === "auth/artifact-not-found",
    );
    const hidden = await createCollection(db, {
      workspaceId,
      title: "Owner only",
      actorId: owner.id,
    });
    await assert.rejects(
      () => saveReference(db, { collectionId: hidden.id, artifactId: screen.id, actorId: fellow.id }),
      (error) => error instanceof AuthError && error.code === "auth/forbidden",
    );
    await assert.rejects(
      () => listReferences(db, hidden.id, fellow.id),
      (error) => error instanceof AuthError && error.code === "auth/forbidden",
    );
  } finally {
    await db.close();
  }
});

test("collection listing filters private collections per caller", async () => {
  const db = await fixtureDb();
  try {
    const { owner, workspaceId } = await workspaceWithOwner(db, "listing");
    const fellow = await member(db, "fellow-listing");
    const stranger = await member(db, "stranger-listing");
    await addMember(db, { workspaceId, userId: fellow.id, role: "member", actorId: owner.id });
    await createCollection(db, { workspaceId, title: "Owner private", actorId: owner.id });
    await createCollection(db, { workspaceId, title: "Team board", visibility: "workspace", actorId: owner.id });
    await createCollection(db, { workspaceId, title: "Fellow private", actorId: fellow.id });
    const ownerView = await listCollections(db, workspaceId, owner.id);
    assert.deepEqual(ownerView.map((entry) => entry.title).sort(), ["Owner private", "Team board"]);
    const fellowView = await listCollections(db, workspaceId, fellow.id);
    assert.deepEqual(fellowView.map((entry) => entry.title).sort(), ["Fellow private", "Team board"]);
    await assert.rejects(
      () => listCollections(db, workspaceId, stranger.id),
      (error) => error instanceof AuthError && error.code === "auth/forbidden",
    );
    await assert.rejects(
      () => listCollections(db, "00000000-0000-0000-0000-000000000000", owner.id),
      (error) => error instanceof AuthError && error.code === "auth/forbidden",
    );
  } finally {
    await db.close();
  }
});

test("collections are isolated across workspaces and cascade on delete", async () => {
  const db = await fixtureDb();
  try {
    const teamA = await workspaceWithOwner(db, "iso-a");
    const teamB = await workspaceWithOwner(db, "iso-b");
    const collectionA = await createCollection(db, {
      workspaceId: teamA.workspaceId,
      title: "Team A board",
      visibility: "workspace",
      actorId: teamA.owner.id,
    });
    await assert.rejects(
      () => getCollection(db, collectionA.id, teamB.owner.id),
      (error) => error instanceof AuthError && error.code === "auth/forbidden",
    );
    const screen = await artifactFixture(db, teamA.workspaceId, teamA.owner.id);
    await saveReference(db, { collectionId: collectionA.id, artifactId: screen.id, actorId: teamA.owner.id });
    await deleteCollection(db, { collectionId: collectionA.id, actorId: teamA.owner.id });
    await assert.rejects(
      () => listReferences(db, collectionA.id, teamA.owner.id),
      (error) => error instanceof AuthError && error.code === "auth/collection-not-found",
    );
    const doomed = await createCollection(db, {
      workspaceId: teamB.workspaceId,
      title: "Doomed",
      visibility: "workspace",
      actorId: teamB.owner.id,
    });
    await db.query("delete from workspaces where id = $1", [teamB.workspaceId]);
    await assert.rejects(
      () => getCollection(db, doomed.id, teamB.owner.id),
      (error) => error instanceof AuthError && error.code === "auth/collection-not-found",
    );
  } finally {
    await db.close();
  }
});

test("board saves append dense positions in save order", async () => {
  const db = await fixtureDb();
  try {
    const { owner, workspaceId } = await workspaceWithOwner(db, "board-append");
    const collection = await createCollection(db, {
      workspaceId,
      title: "Board",
      visibility: "workspace",
      actorId: owner.id,
    });
    const ids = [];
    for (let index = 0; index < 3; index += 1) {
      const source = await createSource(db, { key: `board-source-${index}`, kind: "synthetic" });
      const product = await createProduct(db, { sourceId: source.id, title: "Board app" });
      const version = await createProductVersion(db, { productId: product.id, versionNo: 1 });
      const screen = await createArtifact(db, {
        sourceId: source.id,
        productId: product.id,
        productVersionId: version.id,
        kind: "screen",
        title: `Board screen ${index}`,
        contentHash: String(index).repeat(64).slice(0, 64),
        rightsClassification: "metadata_only",
        visibility: "workspace",
        workspaceId,
        ownerSubject: owner.id,
      });
      const saved = await saveReference(db, {
        collectionId: collection.id,
        artifactId: screen.id,
        actorId: owner.id,
      });
      assert.equal(saved.position, index);
      ids.push(screen.id);
    }
    const refs = await listReferences(db, collection.id, owner.id);
    assert.deepEqual(refs.map((entry) => entry.artifactId), ids);
    assert.deepEqual(refs.map((entry) => entry.position), [0, 1, 2]);
    // Duplicate saves converge without moving the original rank.
    const replay = await saveReference(db, {
      collectionId: collection.id,
      artifactId: ids[0],
      actorId: owner.id,
    });
    assert.equal(replay.position, 0);
    assert.deepEqual((await listReferences(db, collection.id, owner.id)).map((entry) => entry.position), [0, 1, 2]);
  } finally {
    await db.close();
  }
});

test("board moves reorder with dense ranks", async () => {
  const db = await fixtureDb();
  try {
    const { owner, workspaceId } = await workspaceWithOwner(db, "board-move");
    const collection = await createCollection(db, {
      workspaceId,
      title: "Board",
      visibility: "workspace",
      actorId: owner.id,
    });
    const ids = [];
    for (let index = 0; index < 4; index += 1) {
      const source = await createSource(db, { key: `move-source-${index}`, kind: "synthetic" });
      const product = await createProduct(db, { sourceId: source.id, title: "Move app" });
      const version = await createProductVersion(db, { productId: product.id, versionNo: 1 });
      const screen = await createArtifact(db, {
        sourceId: source.id,
        productId: product.id,
        productVersionId: version.id,
        kind: "screen",
        title: `Move screen ${index}`,
        contentHash: `b${index}`.repeat(32).slice(0, 64),
        rightsClassification: "metadata_only",
        visibility: "workspace",
        workspaceId,
        ownerSubject: owner.id,
      });
      await saveReference(db, { collectionId: collection.id, artifactId: screen.id, actorId: owner.id });
      ids.push(screen.id);
    }
    const move = (artifactId, toPosition) => moveReference(db, {
      collectionId: collection.id,
      artifactId,
      actorId: owner.id,
      toPosition,
    });
    let order = await move(ids[2], 0);
    assert.deepEqual(order.map((entry) => entry.artifactId), [ids[2], ids[0], ids[1], ids[3]]);
    assert.deepEqual(order.map((entry) => entry.position), [0, 1, 2, 3]);
    order = await move(ids[2], 3);
    assert.deepEqual(order.map((entry) => entry.artifactId), [ids[0], ids[1], ids[3], ids[2]]);
    order = await move(ids[0], 0);
    assert.deepEqual(order.map((entry) => entry.artifactId), [ids[0], ids[1], ids[3], ids[2]]);
    const listed = await listReferences(db, collection.id, owner.id);
    assert.deepEqual(listed.map((entry) => entry.artifactId), [ids[0], ids[1], ids[3], ids[2]]);
    assert.deepEqual(listed.map((entry) => entry.position), [0, 1, 2, 3]);
  } finally {
    await db.close();
  }
});

test("board moves reject invalid operations without side effects", async () => {
  const db = await fixtureDb();
  try {
    const { owner, workspaceId } = await workspaceWithOwner(db, "board-invalid");
    const collection = await createCollection(db, {
      workspaceId,
      title: "Board",
      visibility: "workspace",
      actorId: owner.id,
    });
    const screen = await artifactFixture(db, workspaceId, owner.id);
    await saveReference(db, { collectionId: collection.id, artifactId: screen.id, actorId: owner.id });
    const before = await listReferences(db, collection.id, owner.id);
    for (const toPosition of [1, 99, -1, 1.5, "0", null]) {
      await assert.rejects(
        () => moveReference(db, { collectionId: collection.id, artifactId: screen.id, actorId: owner.id, toPosition }),
        (error) => error instanceof AuthError,
        `position ${String(toPosition)} fails closed`,
      );
    }
    await assert.rejects(
      () => moveReference(db, {
        collectionId: collection.id,
        artifactId: "11111111-2222-4333-8444-555555555555",
        actorId: owner.id,
        toPosition: 0,
      }),
      (error) => error instanceof AuthError && error.code === "auth/collection-not-found",
    );
    assert.deepEqual(await listReferences(db, collection.id, owner.id), before);
  } finally {
    await db.close();
  }
});

test("board removal closes gaps and moves respect the write gate", async () => {
  const db = await fixtureDb();
  try {
    const { owner, workspaceId } = await workspaceWithOwner(db, "board-gate");
    const fellow = await member(db, "fellow-board-gate");
    await addMember(db, { workspaceId, userId: fellow.id, role: "member", actorId: owner.id });
    const outsider = await member(db, "outsider-board-gate");
    const collection = await createCollection(db, {
      workspaceId,
      title: "Board",
      visibility: "workspace",
      actorId: owner.id,
    });
    const ids = [];
    for (let index = 0; index < 3; index += 1) {
      const source = await createSource(db, { key: `gate-source-${index}`, kind: "synthetic" });
      const product = await createProduct(db, { sourceId: source.id, title: "Gate app" });
      const version = await createProductVersion(db, { productId: product.id, versionNo: 1 });
      const screen = await createArtifact(db, {
        sourceId: source.id,
        productId: product.id,
        productVersionId: version.id,
        kind: "screen",
        title: `Gate screen ${index}`,
        contentHash: `c${index}`.repeat(32).slice(0, 64),
        rightsClassification: "metadata_only",
        visibility: "workspace",
        workspaceId,
        ownerSubject: owner.id,
      });
      await saveReference(db, { collectionId: collection.id, artifactId: screen.id, actorId: owner.id });
      ids.push(screen.id);
    }
    // A workspace member shares the write gate and may reorder.
    const moved = await moveReference(db, {
      collectionId: collection.id,
      artifactId: ids[0],
      actorId: fellow.id,
      toPosition: 2,
    });
    assert.deepEqual(moved.map((entry) => entry.artifactId), [ids[1], ids[2], ids[0]]);
    // Outsiders fail closed with no reorder.
    await assert.rejects(
      () => moveReference(db, { collectionId: collection.id, artifactId: ids[1], actorId: outsider.id, toPosition: 0 }),
      (error) => error instanceof AuthError && error.code === "auth/forbidden",
    );
    // Removal closes the gap; ranks stay dense.
    await removeReference(db, { collectionId: collection.id, artifactId: ids[2], actorId: owner.id });
    const refs = await listReferences(db, collection.id, owner.id);
    assert.deepEqual(refs.map((entry) => entry.artifactId), [ids[1], ids[0]]);
    assert.deepEqual(refs.map((entry) => entry.position), [0, 1]);
  } finally {
    await db.close();
  }
});
