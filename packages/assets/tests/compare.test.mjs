import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../db/src/db.ts";
import { migrateUp } from "../../db/src/migrate.ts";
import { createSource } from "../../db/src/repositories.ts";
import { signUp } from "../../db/src/auth.ts";
import { createWorkspace } from "../../db/src/workspaces.ts";
import { registerAsset } from "../src/registry.ts";
import { compareArtifactsForActor } from "../src/similarity.ts";

const HASH = (char) => char.repeat(64);

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "compare-owner@skilit.example", password: "compare-password-01" });
  const outsider = await signUp(db, { email: "compare-out@skilit.example", password: "compare-password-01" });
  const source = await createSource(db, { key: "compare-source", kind: "synthetic" });
  const left = await registerAsset(db, {
    kind: "icon",
    title: "Compare left arrow",
    summary: "Left navigation arrow",
    sourceId: source.id,
    contentHash: HASH("a"),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "compare-left", tags: ["arrow", "navigation"], license: "MIT" },
    asset: { sha256: HASH("a"), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/co/left" },
  });
  const right = await registerAsset(db, {
    kind: "icon",
    title: "Compare right arrow",
    summary: "Right navigation arrow",
    sourceId: source.id,
    contentHash: HASH("b"),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "compare-right", tags: ["arrow", "navigation"], license: "MIT" },
    asset: { sha256: HASH("b"), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/co/right" },
  });
  return { db, owner, outsider, source, left, right };
}

test("AF-13a-ii: differing artifacts produce observed field diffs", async () => {
  const fx = await fixture();
  try {
    const outcome = await compareArtifactsForActor(fx.db, {
      leftArtifactId: fx.left.artifactId,
      rightArtifactId: fx.right.artifactId,
      actorId: fx.owner.id,
    });
    assert.equal(outcome.left.artifactId, fx.left.artifactId);
    assert.equal(outcome.right.artifactId, fx.right.artifactId);
    assert.equal(outcome.identical, false);
    assert.equal(outcome.score, 0.6);
    assert.deepEqual(outcome.sharedTerms, ["arrow", "compare", "navigation"]);
    assert.deepEqual(outcome.uniqueLeft, ["left"]);
    assert.deepEqual(outcome.uniqueRight, ["right"]);
    assert.deepEqual(
      outcome.fieldDiffs.map((diff) => diff.field),
      ["title", "summary"],
    );
    assert.equal(outcome.left.rightsClassification, "permitted");
    assert.deepEqual(outcome.left.tags, ["arrow", "navigation"]);
  } finally {
    await fx.db.close();
  }
});

test("AF-13a-ii: identical references compare identical with score 1", async () => {
  const fx = await fixture();
  try {
    const outcome = await compareArtifactsForActor(fx.db, {
      leftArtifactId: fx.left.artifactId,
      rightArtifactId: fx.left.artifactId,
      actorId: fx.owner.id,
    });
    assert.equal(outcome.identical, true);
    assert.equal(outcome.score, 1);
    assert.deepEqual(outcome.fieldDiffs, []);
    assert.deepEqual(outcome.uniqueLeft, []);
    assert.deepEqual(outcome.uniqueRight, []);
    assert.ok(outcome.sharedTerms.length > 0);
  } finally {
    await fx.db.close();
  }
});

test("AF-13a-ii: malformed, unknown, and denied identifiers share not-found", async () => {
  const fx = await fixture();
  try {
    await assert.rejects(
      compareArtifactsForActor(fx.db, {
        leftArtifactId: "not-a-uuid",
        rightArtifactId: fx.right.artifactId,
        actorId: fx.owner.id,
      }),
      (error) => error.code === "assets/invalid-record",
    );
    await assert.rejects(
      compareArtifactsForActor(fx.db, {
        leftArtifactId: "00000000-0000-7000-8000-000000000000",
        rightArtifactId: fx.right.artifactId,
        actorId: fx.owner.id,
      }),
      (error) => error.code === "assets/not-found",
    );
    const space = await createWorkspace(fx.db, { name: "Compare private", ownerId: fx.owner.id });
    const hidden = await registerAsset(fx.db, {
      kind: "icon",
      title: "Compare hidden arrow",
      sourceId: fx.source.id,
      contentHash: HASH("f"),
      rightsClassification: "permitted",
      visibility: "private",
      workspaceId: space.workspace.id,
      ownerSubject: fx.owner.id,
      metadata: { tags: ["arrow"], license: "MIT" },
    });
    // Either denied side reads as not-found, with no signal about which.
    await assert.rejects(
      compareArtifactsForActor(fx.db, {
        leftArtifactId: hidden.artifactId,
        rightArtifactId: fx.right.artifactId,
        actorId: fx.outsider.id,
      }),
      (error) => error.code === "assets/not-found",
    );
    await assert.rejects(
      compareArtifactsForActor(fx.db, {
        leftArtifactId: fx.left.artifactId,
        rightArtifactId: hidden.artifactId,
        actorId: fx.outsider.id,
      }),
      (error) => error.code === "assets/not-found",
    );
    // The owner compares the private pair without error.
    const owned = await compareArtifactsForActor(fx.db, {
      leftArtifactId: hidden.artifactId,
      rightArtifactId: fx.right.artifactId,
      actorId: fx.owner.id,
    });
    assert.equal(owned.identical, false);
  } finally {
    await fx.db.close();
  }
});
