import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../db/src/db.ts";
import { migrateUp } from "../../db/src/migrate.ts";
import { createSource } from "../../db/src/repositories.ts";
import { signUp } from "../../db/src/auth.ts";
import { createWorkspace } from "../../db/src/workspaces.ts";
import { registerAsset } from "../src/registry.ts";
import {
  findSimilarForActor,
  jaccardSimilarity,
  tokenizeSimilarityText,
} from "../src/similarity.ts";

const HASH = (char) => char.repeat(64);

test("AF-13a-i: tokenize is lowercase, order-independent, and deduplicated", () => {
  assert.deepEqual(tokenizeSimilarityText("Arrow NAVIGATION arrow!"), ["arrow", "navigation"]);
  assert.deepEqual(tokenizeSimilarityText("b a"), ["a", "b"]);
  assert.deepEqual(tokenizeSimilarityText(""), []);
  assert.deepEqual(tokenizeSimilarityText("a-b_c d"), ["a", "b", "c", "d"]);
});

test("AF-13a-i: jaccard is deterministic with 4-decimal rounding", () => {
  assert.equal(jaccardSimilarity(["a"], ["a"]), 1);
  assert.equal(jaccardSimilarity(["a"], ["b"]), 0);
  assert.equal(jaccardSimilarity([], []), 0);
  assert.equal(jaccardSimilarity(["a", "b"], []), 0);
  assert.equal(jaccardSimilarity(["a", "b", "c"], ["b", "c", "d", "e", "f", "g"]), 0.2857);
  // Argument order never changes the score.
  assert.equal(
    jaccardSimilarity(["x", "y"], ["y", "z"]),
    jaccardSimilarity(["y", "z"], ["x", "y"]),
  );
});

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "similar-owner@skilit.example", password: "similar-password-01" });
  const outsider = await signUp(db, { email: "similar-out@skilit.example", password: "similar-password-01" });
  const source = await createSource(db, { key: "similar-source", kind: "synthetic" });
  const reference = await registerAsset(db, {
    kind: "icon",
    title: "Similar left arrow",
    summary: "Left navigation arrow",
    sourceId: source.id,
    contentHash: HASH("a"),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "similar-left", tags: ["arrow", "navigation"], license: "MIT" },
    asset: { sha256: HASH("a"), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/si/left" },
  });
  const near = await registerAsset(db, {
    kind: "icon",
    title: "Similar right arrow",
    summary: "Right navigation arrow",
    sourceId: source.id,
    contentHash: HASH("b"),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "similar-right", tags: ["arrow", "navigation"], license: "MIT" },
    asset: { sha256: HASH("b"), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/si/right" },
  });
  const far = await registerAsset(db, {
    kind: "icon",
    title: "Arrow upload",
    summary: "Upload marker",
    sourceId: source.id,
    contentHash: HASH("c"),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "similar-upload", tags: ["arrow"], license: "MIT" },
    asset: { sha256: HASH("c"), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/si/upload" },
  });
  const unrelated = await registerAsset(db, {
    kind: "logo",
    title: "Brand circle mark",
    summary: "Corporate logo",
    sourceId: source.id,
    contentHash: HASH("d"),
    rightsClassification: "permitted",
    metadata: { collection: "brand-corpus", ref: "similar-brand", tags: ["brand"], license: "CC0" },
  });
  const restricted = await registerAsset(db, {
    kind: "icon",
    title: "Restricted arrow badge",
    summary: "Trademark badge",
    sourceId: source.id,
    contentHash: HASH("e"),
    rightsClassification: "restricted",
    metadata: { collection: "brand-corpus", ref: "similar-restricted", tags: ["arrow"], license: "proprietary", trademark: true },
  });
  return { db, owner, outsider, source, reference, near, far, unrelated, restricted };
}

test("AF-13a-i: ranks by score with deterministic title/id tie-break", async () => {
  const fx = await fixture();
  try {
    const outcome = await findSimilarForActor(fx.db, {
      artifactId: fx.reference.artifactId,
      actorId: fx.owner.id,
    });
    assert.equal(outcome.reference.artifactId, fx.reference.artifactId);
    assert.equal(outcome.reference.title, "Similar left arrow");
    assert.equal(outcome.truncated, false);
    // near {similar,right,arrow,navigation} vs ref {similar,left,arrow,navigation}: 3/5.
    assert.equal(outcome.total, 3);
    assert.equal(outcome.similar.length, 3);
    const scores = outcome.similar.map((entry) => entry.score);
    assert.ok(scores[0] >= scores[1] && scores[1] >= scores[2], "scores descend");
    assert.equal(outcome.similar[0].artifactId, fx.near.artifactId);
    assert.equal(outcome.similar[0].score, 0.6);
    assert.equal(outcome.similar[1].artifactId, fx.far.artifactId);
    assert.equal(outcome.similar[1].score, 0.1667);
    // Zero-overlap logo is excluded, never returned with score 0.
    assert.ok(outcome.similar.every((entry) => entry.score > 0));
    assert.ok(!outcome.similar.some((entry) => entry.artifactId === fx.unrelated.artifactId));
    // Restricted candidates keep list semantics with rights labels.
    const flagged = outcome.similar.find((entry) => entry.artifactId === fx.restricted.artifactId);
    assert.ok(flagged, "restricted candidate is listed with a label");
    assert.equal(flagged.score, 0.1429);
    assert.equal(flagged.rightsClassification, "restricted");
    assert.equal(flagged.serving, "metadata-only");
    for (const entry of outcome.similar) {
      assert.ok(entry.uri === undefined, "db layer returns ids, transports mint URIs");
      assert.equal(typeof entry.contentHash, "string");
    }
  } finally {
    await fx.db.close();
  }
});

test("AF-13a-i: identical scores break ties by title then id", async () => {
  const db = await openDatabase();
  try {
    await migrateUp(db);
    const owner = await signUp(db, { email: "similar-tie@skilit.example", password: "similar-password-01" });
    const source = await createSource(db, { key: "similar-tie-source", kind: "synthetic" });
    const reference = await registerAsset(db, {
      kind: "icon",
      title: "Twin shape",
      sourceId: source.id,
      contentHash: HASH("1"),
      rightsClassification: "permitted",
      metadata: { tags: ["twin"] },
    });
    const beta = await registerAsset(db, {
      kind: "icon",
      title: "Twin beta",
      sourceId: source.id,
      contentHash: HASH("2"),
      rightsClassification: "permitted",
      metadata: { tags: ["twin"] },
    });
    const alpha = await registerAsset(db, {
      kind: "icon",
      title: "Twin alpha",
      sourceId: source.id,
      contentHash: HASH("3"),
      rightsClassification: "permitted",
      metadata: { tags: ["twin"] },
    });
    const outcome = await findSimilarForActor(db, { artifactId: reference.artifactId, actorId: owner.id });
    assert.equal(outcome.total, 2);
    assert.equal(outcome.similar[0].score, outcome.similar[1].score);
    assert.equal(outcome.similar[0].artifactId, alpha.artifactId);
    assert.equal(outcome.similar[1].artifactId, beta.artifactId);
  } finally {
    await db.close();
  }
});

test("AF-13a-i: kinds filter, limit/offset, and empty results", async () => {
  const fx = await fixture();
  try {
    const logos = await findSimilarForActor(fx.db, {
      artifactId: fx.reference.artifactId,
      actorId: fx.owner.id,
      kinds: ["logo"],
    });
    assert.equal(logos.total, 0);
    assert.deepEqual(logos.similar, []);
    assert.equal(logos.truncated, false);

    const pageOne = await findSimilarForActor(fx.db, {
      artifactId: fx.reference.artifactId,
      actorId: fx.owner.id,
      limit: 1,
    });
    assert.equal(pageOne.total, 3);
    assert.equal(pageOne.similar.length, 1);
    const pageTwo = await findSimilarForActor(fx.db, {
      artifactId: fx.reference.artifactId,
      actorId: fx.owner.id,
      limit: 1,
      offset: 1,
    });
    assert.equal(pageTwo.similar.length, 1);
    assert.notEqual(pageOne.similar[0].artifactId, pageTwo.similar[0].artifactId);
  } finally {
    await fx.db.close();
  }
});

test("AF-13a-i: malformed input fails invalid-record", async () => {
  const fx = await fixture();
  try {
    for (const input of [
      { artifactId: "not-a-uuid", actorId: fx.owner.id },
      { artifactId: fx.reference.artifactId, actorId: fx.owner.id, limit: 0 },
      { artifactId: fx.reference.artifactId, actorId: fx.owner.id, limit: 51 },
      { artifactId: fx.reference.artifactId, actorId: fx.owner.id, offset: -1 },
      { artifactId: fx.reference.artifactId, actorId: fx.owner.id, kinds: ["spaceship"] },
      { artifactId: fx.reference.artifactId, actorId: fx.owner.id, kinds: ["icon", "icon"] },
      { artifactId: fx.reference.artifactId, actorId: fx.owner.id, kinds: [] },
      { artifactId: fx.reference.artifactId, actorId: fx.owner.id, maxCandidates: 0 },
    ]) {
      await assert.rejects(findSimilarForActor(fx.db, input), (error) => error.code === "assets/invalid-record");
    }
  } finally {
    await fx.db.close();
  }
});

test("AF-13a-i: unknown references read as not-found (no oracle)", async () => {
  const fx = await fixture();
  try {
    await assert.rejects(
      findSimilarForActor(fx.db, {
        artifactId: "00000000-0000-7000-8000-000000000000",
        actorId: fx.owner.id,
      }),
      (error) => error.code === "assets/not-found",
    );
  } finally {
    await fx.db.close();
  }
});

test("AF-13a-i: workspace-private references and candidates stay actor-scoped", async () => {
  const fx = await fixture();
  let ws;
  try {
    ws = await createWorkspace(fx.db, { name: "Similar private", ownerId: fx.owner.id });
    const hidden = await registerAsset(fx.db, {
      kind: "icon",
      title: "Similar hidden arrow",
      summary: "Hidden navigation arrow",
      sourceId: fx.source.id,
      contentHash: HASH("f"),
      rightsClassification: "permitted",
      visibility: "private",
      workspaceId: ws.workspace.id,
      ownerSubject: fx.owner.id,
      metadata: { tags: ["arrow", "navigation"], license: "MIT" },
    });
    // Outsider cannot use the private reference at all.
    await assert.rejects(
      findSimilarForActor(fx.db, { artifactId: hidden.artifactId, actorId: fx.outsider.id }),
      (error) => error.code === "assets/not-found",
    );
    // The private candidate never leaks into outsider results.
    const outside = await findSimilarForActor(fx.db, {
      artifactId: fx.reference.artifactId,
      actorId: fx.outsider.id,
    });
    assert.ok(!outside.similar.some((entry) => entry.artifactId === hidden.artifactId));
    // The owner sees it ranked with everyone else.
    const inside = await findSimilarForActor(fx.db, {
      artifactId: fx.reference.artifactId,
      actorId: fx.owner.id,
    });
    assert.ok(inside.similar.some((entry) => entry.artifactId === hidden.artifactId));
  } finally {
    await fx.db.close();
  }
});

test("AF-13a-i: candidate budget truncation is explicit", async () => {
  const fx = await fixture();
  try {
    const outcome = await findSimilarForActor(fx.db, {
      artifactId: fx.reference.artifactId,
      actorId: fx.owner.id,
      maxCandidates: 1,
    });
    assert.equal(outcome.truncated, true);
    assert.ok(outcome.similar.length <= 1);
  } finally {
    await fx.db.close();
  }
});

test("AF-14b-i: research corpus screens share the lexical baseline with kinds filtering", async () => {
  const db = await openDatabase();
  try {
    await migrateUp(db);
    const owner = await signUp(db, { email: "similar-screen@skilit.example", password: "similar-password-01" });
    const outsider = await signUp(db, { email: "similar-screen-out@skilit.example", password: "similar-password-01" });
    const source = await createSource(db, { key: "similar-screen-source", kind: "synthetic" });
    const { createArtifact: make } = await import("../../db/src/graph.ts");
    const ref = await make(db, {
      sourceId: source.id,
      kind: "screen",
      title: "Checkout screen",
      summary: "Payment form checkout",
      contentHash: HASH("a"),
      rightsClassification: "permitted",
      visibility: "public",
      metadata: { tags: ["checkout"] },
    });
    const near = await make(db, {
      sourceId: source.id,
      kind: "screen",
      title: "Checkout form screen",
      summary: "Payment checkout form",
      contentHash: HASH("b"),
      rightsClassification: "permitted",
      visibility: "public",
      metadata: { tags: ["checkout"] },
    });
    await make(db, {
      sourceId: source.id,
      kind: "page",
      title: "Settings page",
      summary: "Preferences and toggles",
      contentHash: HASH("c"),
      rightsClassification: "permitted",
      visibility: "public",
      metadata: { tags: ["settings"] },
    });
    const outcome = await findSimilarForActor(db, { artifactId: ref.id, actorId: owner.id });
    assert.equal(outcome.reference.title, "Checkout screen");
    assert.equal(outcome.similar[0].artifactId, near.id);
    assert.ok(outcome.similar[0].score > 0);
    assert.ok(outcome.similar.every((entry) => entry.score > 0));
    const screens = await findSimilarForActor(db, { artifactId: ref.id, actorId: owner.id, kinds: ["screen"] });
    assert.ok(screens.total >= 1);
    assert.ok(screens.similar.every((entry) => entry.kind === "screen"));
    const icons = await findSimilarForActor(db, { artifactId: ref.id, actorId: owner.id, kinds: ["icon"] });
    assert.equal(icons.total, 0);
    assert.deepEqual(icons.similar, []);
    // Private screens stay actor-scoped under the expanded kinds.
    const space = await createWorkspace(db, { name: "Similar screen private", ownerId: owner.id });
    const hidden = await make(db, {
      sourceId: source.id,
      kind: "screen",
      title: "Checkout hidden screen",
      summary: "Payment form checkout",
      contentHash: HASH("d"),
      rightsClassification: "permitted",
      visibility: "private",
      workspaceId: space.workspace.id,
      ownerSubject: owner.id,
      metadata: { tags: ["checkout"] },
    });
    await assert.rejects(
      findSimilarForActor(db, { artifactId: hidden.id, actorId: outsider.id }),
      (error) => error.code === "assets/not-found",
    );
    const outside = await findSimilarForActor(db, { artifactId: ref.id, actorId: outsider.id });
    assert.ok(!outside.similar.some((entry) => entry.artifactId === hidden.id));
  } finally {
    await db.close();
  }
});

test("AF-14c: global non-public non-registry rows never leak into candidates", async () => {
  const db = await openDatabase();
  try {
    await migrateUp(db);
    const owner = await signUp(db, { email: "similar-gate@skilit.example", password: "similar-password-01" });
    const outsider = await signUp(db, { email: "similar-gate-out@skilit.example", password: "similar-password-01" });
    const source = await createSource(db, { key: "similar-gate-source", kind: "synthetic" });
    const { createArtifact: make } = await import("../../db/src/graph.ts");
    const ref = await make(db, {
      sourceId: source.id,
      kind: "screen",
      title: "Gate checkout screen",
      summary: "Payment form checkout",
      contentHash: HASH("a"),
      rightsClassification: "permitted",
      visibility: "public",
      metadata: { tags: ["checkout"] },
    });
    // Ownerless global-private screen: denied to every actor by the gate.
    const orphan = await make(db, {
      sourceId: source.id,
      kind: "screen",
      title: "Gate checkout orphan",
      summary: "Payment form checkout",
      contentHash: HASH("b"),
      rightsClassification: "permitted",
      visibility: "private",
      metadata: { tags: ["checkout"] },
    });
    for (const actor of [owner, outsider]) {
      const outcome = await findSimilarForActor(db, { artifactId: ref.id, actorId: actor.id });
      assert.ok(!outcome.similar.some((entry) => entry.artifactId === orphan.id));
    }
    // The orphan is not even usable as a reference, for any actor.
    for (const actor of [owner, outsider]) {
      await assert.rejects(
        findSimilarForActor(db, { artifactId: orphan.id, actorId: actor.id }),
        (error) => error.code === "assets/not-found",
      );
    }
  } finally {
    await db.close();
  }
});
