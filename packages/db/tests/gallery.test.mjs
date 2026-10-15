import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../db/src/db.ts";
import { migrateUp } from "../../db/src/migrate.ts";
import { createProduct, createProductVersion, createSource } from "../../db/src/repositories.ts";
import { createArtifact } from "../../db/src/graph.ts";
import { createFlow, addFlowStep } from "../../db/src/workflows.ts";
import { signUp } from "../../db/src/auth.ts";
import { createWorkspace } from "../../db/src/workspaces.ts";
import { GalleryError, listProductsForActor, listProductVersionsForActor } from "../src/gallery.ts";

const HEX = (char) => char.repeat(64);

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "gallery-owner@skelet.example", password: "gallery-password-01" });
  const outsider = await signUp(db, { email: "gallery-out@skelet.example", password: "gallery-password-01" });
  const source = await createSource(db, { key: "gallery-source", kind: "synthetic" });
  return { db, owner, outsider, source };
}

async function artifact(db, sourceId, productId, versionId, overrides) {
  return createArtifact(db, {
    sourceId,
    productId,
    productVersionId: versionId,
    kind: "screen",
    title: "Gallery screen",
    contentHash: HEX("a"),
    rightsClassification: "permitted",
    visibility: "public",
    ...overrides,
  });
}

test("AF-14d: products list with visible counts in deterministic order", async () => {
  const fx = await fixture();
  try {
    const beta = await createProduct(fx.db, { sourceId: fx.source.id, title: "Beta app" });
    const alpha = await createProduct(fx.db, { sourceId: fx.source.id, title: "Alpha app" });
    const betaV1 = await createProductVersion(fx.db, { productId: beta.id, versionNo: 1 });
    const alphaV1 = await createProductVersion(fx.db, { productId: alpha.id, versionNo: 1 });
    const alphaV2 = await createProductVersion(fx.db, { productId: alpha.id, versionNo: 2 });
    await artifact(fx.db, fx.source.id, beta.id, betaV1.id, { title: "Beta screen" });
    await artifact(fx.db, fx.source.id, alpha.id, alphaV1.id, { title: "Alpha one" });
    await artifact(fx.db, fx.source.id, alpha.id, alphaV2.id, { title: "Alpha two" });
    const outcome = await listProductsForActor(fx.db, { actorId: fx.owner.id });
    assert.equal(outcome.total, 2);
    assert.deepEqual(outcome.products.map((entry) => entry.title), ["Alpha app", "Beta app"]);
    assert.deepEqual(outcome.products.find((entry) => entry.title === "Alpha app").versionCount, 2);
    assert.deepEqual(outcome.products.find((entry) => entry.title === "Beta app").artifactCount, 1);
    // Empty versions contribute no version count.
    const empty = await createProduct(fx.db, { sourceId: fx.source.id, title: "Empty app" });
    await createProductVersion(fx.db, { productId: empty.id, versionNo: 1 });
    const again = await listProductsForActor(fx.db, { actorId: fx.owner.id });
    assert.equal(again.total, 2, "versions without readable artifacts stay invisible");
    // Deterministic repeatability.
    assert.deepEqual(await listProductsForActor(fx.db, { actorId: fx.owner.id }), again);
  } finally {
    await fx.db.close();
  }
});

test("AF-14d: versions list per product with readable counts", async () => {
  const fx = await fixture();
  try {
    const product = await createProduct(fx.db, { sourceId: fx.source.id, title: "Versioned app" });
    const v1 = await createProductVersion(fx.db, { productId: product.id, versionNo: 1 });
    const v2 = await createProductVersion(fx.db, { productId: product.id, versionNo: 2 });
    await artifact(fx.db, fx.source.id, product.id, v1.id, { title: "V1 screen" });
    await artifact(fx.db, fx.source.id, product.id, v2.id, { title: "V2 screen" });
    const outcome = await listProductVersionsForActor(fx.db, { actorId: fx.owner.id, productId: product.id });
    assert.equal(outcome.total, 2);
    assert.deepEqual(outcome.versions.map((entry) => entry.versionNo), [1, 2]);
    assert.ok(outcome.versions.every((entry) => entry.artifactCount === 1));
    const page = await listProductVersionsForActor(fx.db, { actorId: fx.owner.id, productId: product.id, limit: 1 });
    assert.equal(page.versions.length, 1);
    assert.equal(page.total, 2);
  } finally {
    await fx.db.close();
  }
});

test("AF-14d: unknown products read as empty with no oracle", async () => {
  const fx = await fixture();
  try {
    const ghost = "00000000-0000-7000-8000-000000000000";
    const outcome = await listProductVersionsForActor(fx.db, { actorId: fx.owner.id, productId: ghost });
    assert.equal(outcome.total, 0);
    assert.deepEqual(outcome.versions, []);
    const empty = await listProductsForActor(fx.db, { actorId: fx.owner.id });
    assert.equal(empty.total, 0);
  } finally {
    await fx.db.close();
  }
});

test("AF-14d: malformed identifiers and limits fail invalid-input", async () => {
  const fx = await fixture();
  try {
    const product = await createProduct(fx.db, { sourceId: fx.source.id, title: "Strict app" });
    for (const input of [
      { actorId: fx.owner.id, productId: "nope" },
      { actorId: "", productId: product.id },
      { actorId: fx.owner.id, productId: product.id, limit: 0 },
      { actorId: fx.owner.id, productId: product.id, limit: 51 },
    ]) {
      await assert.rejects(listProductVersionsForActor(fx.db, input), (error) => error instanceof GalleryError);
    }
    await assert.rejects(listProductsForActor(fx.db, { actorId: "", limit: 1 }), (error) => error instanceof GalleryError);
  } finally {
    await fx.db.close();
  }
});

test("AF-14d: private and orphan artifacts never surface in the gallery", async () => {
  const fx = await fixture();
  try {
    const space = await createWorkspace(fx.db, { name: "Gallery private", ownerId: fx.owner.id });
    const product = await createProduct(fx.db, { sourceId: fx.source.id, title: "Vault app" });
    const version = await createProductVersion(fx.db, { productId: product.id, versionNo: 1 });
    await createArtifact(fx.db, {
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
    const orphanProduct = await createProduct(fx.db, { sourceId: fx.source.id, title: "Orphan app" });
    const orphanVersion = await createProductVersion(fx.db, { productId: orphanProduct.id, versionNo: 1 });
    await createArtifact(fx.db, {
      sourceId: fx.source.id,
      productId: orphanProduct.id,
      productVersionId: orphanVersion.id,
      kind: "screen",
      title: "Orphan screen",
      contentHash: HEX("c"),
      rightsClassification: "permitted",
      visibility: "private",
    });
    const outside = await listProductsForActor(fx.db, { actorId: fx.outsider.id });
    assert.equal(outside.total, 0);
    assert.ok(!JSON.stringify(outside).includes("Vault screen"));
    assert.ok(!JSON.stringify(outside).includes("Orphan screen"));
    const inside = await listProductsForActor(fx.db, { actorId: fx.owner.id });
    assert.equal(inside.total, 1);
    assert.equal(inside.products[0].title, "Vault app");
    const versions = await listProductVersionsForActor(fx.db, { actorId: fx.outsider.id, productId: product.id });
    assert.equal(versions.total, 0);
  } finally {
    await fx.db.close();
  }
});

test("AF-14d: gallery versions feed flow and change tools", async () => {
  const fx = await fixture();
  try {
    const product = await createProduct(fx.db, { sourceId: fx.source.id, title: "Journey app" });
    const v1 = await createProductVersion(fx.db, { productId: product.id, versionNo: 1 });
    const screen = await artifact(fx.db, fx.source.id, product.id, v1.id, { title: "Journey screen" });
    const flow = await createFlow(fx.db, { sourceId: fx.source.id, productVersionId: v1.id, title: "Journey flow" });
    await addFlowStep(fx.db, { flowId: flow.id, position: 0, artifactId: screen.id });
    const versions = await listProductVersionsForActor(fx.db, { actorId: fx.owner.id, productId: product.id });
    assert.equal(versions.total, 1);
    assert.equal(versions.versions[0].versionId, v1.id);
  } finally {
    await fx.db.close();
  }
});
