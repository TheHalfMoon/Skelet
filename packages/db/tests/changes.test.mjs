import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../db/src/db.ts";
import { migrateUp } from "../../db/src/migrate.ts";
import { createProduct, createProductVersion, createSource } from "../../db/src/repositories.ts";
import { createArtifact } from "../../db/src/graph.ts";
import { addFlowStep, createFlow } from "../../db/src/workflows.ts";
import { signUp } from "../../db/src/auth.ts";
import { createWorkspace } from "../../db/src/workspaces.ts";
import { importCorpusFixture } from "../../ingest/src/corpus.ts";
import { ChangesError, getChangesForActor } from "../src/changes.ts";

const HEX = (char) => char.repeat(64);

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "changes-owner@skilit.example", password: "changes-password-01" });
  const outsider = await signUp(db, { email: "changes-out@skilit.example", password: "changes-password-01" });
  const source = await createSource(db, { key: "changes-source", kind: "synthetic" });
  return { db, owner, outsider, source };
}

async function productWithVersions(db, sourceId, title = "Changes app") {
  const product = await createProduct(db, { sourceId, title });
  const v1 = await createProductVersion(db, { productId: product.id, versionNo: 1 });
  const v2 = await createProductVersion(db, { productId: product.id, versionNo: 2 });
  return { product, v1, v2 };
}

async function artifact(db, sourceId, productId, versionId, overrides) {
  return createArtifact(db, {
    sourceId,
    productId,
    productVersionId: versionId,
    kind: "screen",
    title: "Screen",
    contentHash: HEX("a"),
    rightsClassification: "permitted",
    visibility: "public",
    ...overrides,
  });
}

test("AF-15a: identical version IDs return empty identical changes", async () => {
  const fx = await fixture();
  try {
    const { product, v1 } = await productWithVersions(fx.db, fx.source.id);
    await artifact(fx.db, fx.source.id, product.id, v1.id, { title: "Keep screen", contentHash: HEX("a") });
    const outcome = await getChangesForActor(fx.db, {
      actorId: fx.owner.id,
      fromVersionId: v1.id,
      toVersionId: v1.id,
    });
    assert.equal(outcome.identical, true);
    assert.deepEqual(outcome.changes, []);
    assert.equal(outcome.total, 0);
    assert.equal(outcome.productId, product.id);
  } finally {
    await fx.db.close();
  }
});

test("AF-15a: added, removed, and modified artifacts diff deterministically", async () => {
  const fx = await fixture();
  try {
    const { product, v1, v2 } = await productWithVersions(fx.db, fx.source.id);
    await artifact(fx.db, fx.source.id, product.id, v1.id, {
      title: "Keep screen",
      summary: "same",
      contentHash: HEX("a"),
    });
    await artifact(fx.db, fx.source.id, product.id, v1.id, {
      title: "Old screen",
      summary: "gone",
      contentHash: HEX("b"),
    });
    await artifact(fx.db, fx.source.id, product.id, v1.id, {
      title: "Edit screen",
      summary: "before",
      contentHash: HEX("c"),
    });
    await artifact(fx.db, fx.source.id, product.id, v2.id, {
      title: "Keep screen",
      summary: "same",
      contentHash: HEX("a"),
    });
    await artifact(fx.db, fx.source.id, product.id, v2.id, {
      title: "New screen",
      summary: "fresh",
      contentHash: HEX("d"),
    });
    await artifact(fx.db, fx.source.id, product.id, v2.id, {
      title: "Edit screen",
      summary: "after",
      contentHash: HEX("e"),
    });

    const outcome = await getChangesForActor(fx.db, {
      actorId: fx.owner.id,
      fromVersionId: v1.id,
      toVersionId: v2.id,
    });
    assert.equal(outcome.identical, false);
    assert.equal(outcome.total, 3);
    const byKey = new Map(outcome.changes.map((entry) => [entry.key, entry]));
    assert.equal(byKey.get("screen::New screen").change, "added");
    assert.equal(byKey.get("screen::Old screen").change, "removed");
    const edited = byKey.get("screen::Edit screen");
    assert.equal(edited.change, "changed");
    assert.ok(edited.fieldDiffs.some((diff) => diff.field === "summary"));
    assert.equal(edited.from.summary, "before");
    assert.equal(edited.to.summary, "after");
    // Stable ordering: artifact keys sort byte-wise.
    assert.deepEqual(
      outcome.changes.map((entry) => entry.key),
      ["screen::Edit screen", "screen::New screen", "screen::Old screen"],
    );
    // Deterministic repeatability: second call is byte-identical.
    const repeat = await getChangesForActor(fx.db, {
      actorId: fx.owner.id,
      fromVersionId: v1.id,
      toVersionId: v2.id,
    });
    assert.deepEqual(repeat, outcome);
    // Stable change IDs.
    for (const entry of outcome.changes) {
      assert.match(entry.id, /^chg_[0-9a-f]{16}$/);
    }
  } finally {
    await fx.db.close();
  }
});

test("AF-15a: empty change sets report identical with zero total", async () => {
  const fx = await fixture();
  try {
    const { product, v1, v2 } = await productWithVersions(fx.db, fx.source.id);
    for (const version of [v1, v2]) {
      await artifact(fx.db, fx.source.id, product.id, version.id, {
        title: "Same screen",
        summary: "same",
        contentHash: HEX("a"),
      });
    }
    const outcome = await getChangesForActor(fx.db, {
      actorId: fx.owner.id,
      fromVersionId: v1.id,
      toVersionId: v2.id,
    });
    assert.equal(outcome.identical, true);
    assert.equal(outcome.total, 0);
    assert.deepEqual(outcome.changes, []);
  } finally {
    await fx.db.close();
  }
});

test("AF-15a: flow add, remove, change, and reorder are distinguished", async () => {
  const fx = await fixture();
  try {
    const { product, v1, v2 } = await productWithVersions(fx.db, fx.source.id);
    const mk = async (versionId, title, hash) =>
      artifact(fx.db, fx.source.id, product.id, versionId, { title, contentHash: hash });
    const v1a = await mk(v1.id, "Step A", HEX("a"));
    const v1b = await mk(v1.id, "Step B", HEX("b"));
    const v1c = await mk(v1.id, "Step C", HEX("c"));
    const v2a = await mk(v2.id, "Step A", HEX("a"));
    const v2b = await mk(v2.id, "Step B", HEX("b"));
    const v2c = await mk(v2.id, "Step C", HEX("c"));

    const stable = await createFlow(fx.db, { sourceId: fx.source.id, productVersionId: v1.id, title: "Stable tour" });
    await addFlowStep(fx.db, { flowId: stable.id, position: 0, artifactId: v1a.id });
    const stable2 = await createFlow(fx.db, { sourceId: fx.source.id, productVersionId: v2.id, title: "Stable tour" });
    await addFlowStep(fx.db, { flowId: stable2.id, position: 0, artifactId: v2a.id });

    const reorder1 = await createFlow(fx.db, { sourceId: fx.source.id, productVersionId: v1.id, title: "Order tour" });
    await addFlowStep(fx.db, { flowId: reorder1.id, position: 0, artifactId: v1a.id });
    await addFlowStep(fx.db, { flowId: reorder1.id, position: 1, artifactId: v1b.id });
    const reorder2 = await createFlow(fx.db, { sourceId: fx.source.id, productVersionId: v2.id, title: "Order tour" });
    await addFlowStep(fx.db, { flowId: reorder2.id, position: 0, artifactId: v2b.id });
    await addFlowStep(fx.db, { flowId: reorder2.id, position: 1, artifactId: v2a.id });

    const gone = await createFlow(fx.db, { sourceId: fx.source.id, productVersionId: v1.id, title: "Gone tour" });
    await addFlowStep(fx.db, { flowId: gone.id, position: 0, artifactId: v1c.id });
    const fresh = await createFlow(fx.db, { sourceId: fx.source.id, productVersionId: v2.id, title: "Fresh tour" });
    await addFlowStep(fx.db, { flowId: fresh.id, position: 0, artifactId: v2c.id });

    const outcome = await getChangesForActor(fx.db, {
      actorId: fx.owner.id,
      fromVersionId: v1.id,
      toVersionId: v2.id,
    });
    const flows = new Map(
      outcome.changes.filter((entry) => entry.objectKind === "flow").map((entry) => [entry.key, entry]),
    );
    assert.equal(flows.get("Fresh tour").change, "added");
    assert.equal(flows.get("Gone tour").change, "removed");
    assert.equal(flows.get("Order tour").change, "reordered");
    assert.ok(!flows.has("Stable tour"), "unchanged flows produce no record");
    const reordered = flows.get("Order tour");
    assert.deepEqual(reordered.fieldDiffs[0].field, "steps.order");
  } finally {
    await fx.db.close();
  }
});

test("AF-15a: cross-product comparisons are unsupported", async () => {
  const fx = await fixture();
  try {
    const first = await createProduct(fx.db, { sourceId: fx.source.id, title: "First app" });
    const second = await createProduct(fx.db, { sourceId: fx.source.id, title: "Second app" });
    const v1 = await createProductVersion(fx.db, { productId: first.id, versionNo: 1 });
    const v2 = await createProductVersion(fx.db, { productId: second.id, versionNo: 1 });
    await assert.rejects(
      getChangesForActor(fx.db, { actorId: fx.owner.id, fromVersionId: v1.id, toVersionId: v2.id }),
      (error) => error instanceof ChangesError && error.code === "changes/unsupported",
    );
  } finally {
    await fx.db.close();
  }
});

test("AF-15a: missing versions read as not-found with no oracle", async () => {
  const fx = await fixture();
  try {
    const { v1 } = await productWithVersions(fx.db, fx.source.id);
    const ghost = "00000000-0000-7000-8000-000000000000";
    await assert.rejects(
      getChangesForActor(fx.db, { actorId: fx.owner.id, fromVersionId: ghost, toVersionId: v1.id }),
      (error) => error instanceof ChangesError && error.code === "changes/not-found",
    );
    await assert.rejects(
      getChangesForActor(fx.db, { actorId: fx.owner.id, fromVersionId: v1.id, toVersionId: ghost }),
      (error) => error instanceof ChangesError && error.code === "changes/not-found",
    );
  } finally {
    await fx.db.close();
  }
});

test("AF-15a: malformed identifiers and limits fail invalid-input", async () => {
  const fx = await fixture();
  try {
    const { v1, v2 } = await productWithVersions(fx.db, fx.source.id);
    for (const input of [
      { actorId: fx.owner.id, fromVersionId: "nope", toVersionId: v2.id },
      { actorId: fx.owner.id, fromVersionId: v1.id, toVersionId: "nope" },
      { actorId: "", fromVersionId: v1.id, toVersionId: v2.id },
      { actorId: fx.owner.id, fromVersionId: v1.id, toVersionId: v2.id, limit: 0 },
      { actorId: fx.owner.id, fromVersionId: v1.id, toVersionId: v2.id, limit: 51 },
      { actorId: fx.owner.id, fromVersionId: v1.id, toVersionId: v2.id, offset: -1 },
    ]) {
      await assert.rejects(getChangesForActor(fx.db, input), (error) => error instanceof ChangesError && error.code === "changes/invalid-input");
    }
  } finally {
    await fx.db.close();
  }
});

test("AF-15a: private workspace artifacts never leak to outsiders", async () => {
  const fx = await fixture();
  try {
    const space = await createWorkspace(fx.db, { name: "Changes private", ownerId: fx.owner.id });
    const product = await createProduct(fx.db, { sourceId: fx.source.id, title: "Vault app" });
    const v1 = await createProductVersion(fx.db, { productId: product.id, versionNo: 1 });
    const v2 = await createProductVersion(fx.db, { productId: product.id, versionNo: 2 });
    await createArtifact(fx.db, {
      sourceId: fx.source.id,
      productId: product.id,
      productVersionId: v1.id,
      kind: "screen",
      title: "Vault old",
      contentHash: HEX("a"),
      rightsClassification: "permitted",
      visibility: "private",
      workspaceId: space.workspace.id,
      ownerSubject: fx.owner.id,
    });
    await createArtifact(fx.db, {
      sourceId: fx.source.id,
      productId: product.id,
      productVersionId: v2.id,
      kind: "screen",
      title: "Vault new",
      contentHash: HEX("b"),
      rightsClassification: "permitted",
      visibility: "private",
      workspaceId: space.workspace.id,
      ownerSubject: fx.owner.id,
    });
    await artifact(fx.db, fx.source.id, product.id, v1.id, { title: "Public old", contentHash: HEX("c") });
    await artifact(fx.db, fx.source.id, product.id, v2.id, { title: "Public new", contentHash: HEX("d") });

    const inside = await getChangesForActor(fx.db, { actorId: fx.owner.id, fromVersionId: v1.id, toVersionId: v2.id });
    assert.equal(inside.total, 4);
    const outside = await getChangesForActor(fx.db, { actorId: fx.outsider.id, fromVersionId: v1.id, toVersionId: v2.id });
    assert.equal(outside.total, 2);
    const text = JSON.stringify(outside);
    assert.ok(!text.includes("Vault old"));
    assert.ok(!text.includes("Vault new"));
  } finally {
    await fx.db.close();
  }
});

test("AF-15a: restricted artifacts travel as labeled change entries", async () => {
  const fx = await fixture();
  try {
    const space = await createWorkspace(fx.db, { name: "Changes rights", ownerId: fx.owner.id });
    const { product, v1, v2 } = await productWithVersions(fx.db, fx.source.id);
    await createArtifact(fx.db, {
      sourceId: fx.source.id,
      productId: product.id,
      productVersionId: v1.id,
      kind: "screen",
      title: "Brand screen",
      summary: "before",
      contentHash: HEX("a"),
      rightsClassification: "restricted",
      visibility: "workspace",
      workspaceId: space.workspace.id,
      ownerSubject: fx.owner.id,
    });
    await createArtifact(fx.db, {
      sourceId: fx.source.id,
      productId: product.id,
      productVersionId: v2.id,
      kind: "screen",
      title: "Brand screen",
      summary: "after",
      contentHash: HEX("b"),
      rightsClassification: "restricted",
      visibility: "workspace",
      workspaceId: space.workspace.id,
      ownerSubject: fx.owner.id,
    });
    const outcome = await getChangesForActor(fx.db, { actorId: fx.owner.id, fromVersionId: v1.id, toVersionId: v2.id });
    assert.equal(outcome.total, 1);
    assert.equal(outcome.changes[0].change, "changed");
    assert.equal(outcome.changes[0].to.rightsClassification, "restricted");
  } finally {
    await fx.db.close();
  }
});

test("AF-15a: pagination slices deterministically with limit and offset", async () => {
  const fx = await fixture();
  try {
    const { product, v1, v2 } = await productWithVersions(fx.db, fx.source.id);
    await artifact(fx.db, fx.source.id, product.id, v1.id, { title: "Gone one", contentHash: HEX("a") });
    await artifact(fx.db, fx.source.id, product.id, v2.id, { title: "Fresh one", contentHash: HEX("b") });
    await artifact(fx.db, fx.source.id, product.id, v2.id, { title: "Fresh two", contentHash: HEX("c") });
    const pageOne = await getChangesForActor(fx.db, {
      actorId: fx.owner.id,
      fromVersionId: v1.id,
      toVersionId: v2.id,
      limit: 1,
      offset: 0,
    });
    assert.equal(pageOne.total, 3);
    assert.equal(pageOne.changes.length, 1);
    const pageTwo = await getChangesForActor(fx.db, {
      actorId: fx.owner.id,
      fromVersionId: v1.id,
      toVersionId: v2.id,
      limit: 1,
      offset: 1,
    });
    assert.equal(pageTwo.changes.length, 1);
    assert.notEqual(pageOne.changes[0].id, pageTwo.changes[0].id);
  } finally {
    await fx.db.close();
  }
});

test("AF-15a: duplicate titles resolve by ledger external identity, not collapse", async () => {
  const fx = await fixture();
  try {
    const corpus = {
      products: [
        {
          externalId: "dup-shop",
          title: "Dup Shop",
          versions: [
            {
              versionNo: 1,
              artifacts: [
                { externalId: "card-a", kind: "screen", title: "Same title", summary: "first", rightsClassification: "permitted" },
                { externalId: "card-b", kind: "screen", title: "Same title", summary: "second", rightsClassification: "permitted" },
              ],
              flows: [],
            },
            {
              versionNo: 2,
              artifacts: [
                { externalId: "card-a", kind: "screen", title: "Same title", summary: "first-edited", rightsClassification: "permitted" },
                { externalId: "card-b", kind: "screen", title: "Same title", summary: "second", rightsClassification: "permitted" },
              ],
              flows: [],
            },
          ],
        },
      ],
    };
    await importCorpusFixture(fx.db, { sourceId: fx.source.id, sourceVersion: "dup-1", corpus });
    const versions = await fx.db.query(`select id, version_no from product_versions order by version_no`);
    const v1 = versions.rows.find((row) => Number(row.version_no) === 1).id;
    const v2 = versions.rows.find((row) => Number(row.version_no) === 2).id;
    const outcome = await getChangesForActor(fx.db, {
      actorId: fx.owner.id,
      fromVersionId: String(v1),
      toVersionId: String(v2),
    });
    assert.equal(outcome.total, 1);
    assert.equal(outcome.changes[0].change, "changed");
    assert.equal(outcome.changes[0].key, "screen::ext:card-a");
  } finally {
    await fx.db.close();
  }
});
