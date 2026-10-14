import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../db/src/db.ts";
import { migrateUp } from "../../db/src/migrate.ts";
import { createSource } from "../../db/src/repositories.ts";
import { signUp } from "../../db/src/auth.ts";
import { createWorkspace } from "../../db/src/workspaces.ts";
import {
  CorpusError,
  getFlowStepsForActor,
  importCorpusFixture,
  listFlowsForActor,
  validateCorpusInput,
} from "../src/corpus.ts";

const SOURCE_VERSION = "corpus-fixture-1";

function corpus() {
  return {
    products: [
      {
        externalId: "acme-shop",
        title: "Acme Shop",
        versions: [
          {
            versionNo: 1,
            artifacts: [
              {
                externalId: "home-screen",
                kind: "screen",
                title: "Acme home screen",
                summary: "Storefront landing",
                tags: ["storefront"],
                rightsClassification: "permitted",
              },
              {
                externalId: "checkout-flow-screen",
                kind: "screen",
                title: "Acme checkout screen",
                summary: "Checkout form",
                tags: ["checkout"],
                rightsClassification: "permitted",
              },
            ],
            flows: [
              {
                externalId: "buy-journey",
                title: "Buy journey",
                steps: [
                  { artifactExternalId: "home-screen", position: 0 },
                  {
                    artifactExternalId: "checkout-flow-screen",
                    position: 1,
                    interaction: { action: "tap", target: "checkout-button" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "corpus-owner@skelet.example", password: "corpus-password-01" });
  const outsider = await signUp(db, { email: "corpus-out@skelet.example", password: "corpus-password-01" });
  const source = await createSource(db, { key: "corpus-source", kind: "synthetic" });
  return { db, owner, outsider, source };
}

async function counts(db) {
  const tables = ["products", "product_versions", "artifacts", "flows", "flow_steps", "import_records"];
  const out = {};
  for (const table of tables) {
    const result = await db.query(`select count(*)::int as n from ${table}`);
    out[table] = result.rows[0].n;
  }
  return out;
}

test("AF-14a: valid corpus imports with exact counts", async () => {
  const fx = await fixture();
  try {
    const summary = await importCorpusFixture(fx.db, {
      sourceId: fx.source.id,
      sourceVersion: SOURCE_VERSION,
      corpus: corpus(),
    });
    assert.deepEqual(summary, {
      products: 1,
      versions: 1,
      artifacts: 2,
      flows: 1,
      steps: 2,
      replayed: false,
    });
  } finally {
    await fx.db.close();
  }
});

test("AF-14a: identical replay is a no-op returning the same IDs", async () => {
  const fx = await fixture();
  try {
    const first = await importCorpusFixture(fx.db, {
      sourceId: fx.source.id,
      sourceVersion: SOURCE_VERSION,
      corpus: corpus(),
    });
    assert.equal(first.replayed, false);
    const before = await counts(fx.db);
    const second = await importCorpusFixture(fx.db, {
      sourceId: fx.source.id,
      sourceVersion: SOURCE_VERSION,
      corpus: corpus(),
    });
    assert.equal(second.replayed, true);
    assert.deepEqual({ ...second, replayed: false }, { ...first, replayed: false });
    assert.deepEqual(await counts(fx.db), before);
    // Flows resolve through the ledger to the same canonical rows.
    const listed = await listFlowsForActor(fx.db, { actorId: fx.owner.id });
    assert.equal(listed.total, 1);
    const steps = await getFlowStepsForActor(fx.db, { flowId: listed.flows[0].flowId, actorId: fx.owner.id });
    assert.equal(steps.steps.length, 2);
    assert.deepEqual(steps.steps.map((step) => step.position), [0, 1]);
    assert.deepEqual(steps.steps[1].interaction, { action: "tap", target: "checkout-button" });
  } finally {
    await fx.db.close();
  }
});

test("AF-14a: altered replay fails closed with conflict", async () => {
  const fx = await fixture();
  try {
    await importCorpusFixture(fx.db, {
      sourceId: fx.source.id,
      sourceVersion: SOURCE_VERSION,
      corpus: corpus(),
    });
    const tampered = corpus();
    tampered.products[0].title = "Acme Shop Renamed";
    await assert.rejects(
      importCorpusFixture(fx.db, {
        sourceId: fx.source.id,
        sourceVersion: SOURCE_VERSION,
        corpus: tampered,
      }),
      (error) => error instanceof CorpusError && error.code === "corpus/conflict",
    );
  } finally {
    await fx.db.close();
  }
});

test("AF-14a: invalid corpora fail closed with zero writes", async () => {
  const fx = await fixture();
  try {
    const before = await counts(fx.db);
    const bad = [
      { products: [] },
      { products: [{ externalId: "x", title: "X", versions: [] }] },
      (() => {
        const c = corpus();
        c.products[0].versions[0].flows[0].steps[0].artifactExternalId = "ghost";
        return c;
      })(),
      (() => {
        const c = corpus();
        c.products[0].versions[0].flows[0].steps[1].position = 0;
        return c;
      })(),
      (() => {
        const c = corpus();
        c.products[0].versions[0].artifacts[0].kind = "spaceship";
        return c;
      })(),
      (() => {
        const c = corpus();
        delete c.products[0].versions[0].artifacts[0].rightsClassification;
        return c;
      })(),
    ];
    for (const entry of bad) {
      await assert.rejects(
        importCorpusFixture(fx.db, { sourceId: fx.source.id, sourceVersion: SOURCE_VERSION, corpus: entry }),
        (error) => error instanceof CorpusError && error.code === "corpus/invalid-input",
      );
    }
    assert.deepEqual(await counts(fx.db), before);
    assert.throws(() => validateCorpusInput({ products: [] }), (error) => error instanceof CorpusError);
  } finally {
    await fx.db.close();
  }
});

test("AF-14a: flows with private steps stay actor-scoped", async () => {
  const fx = await fixture();
  try {
    const space = await createWorkspace(fx.db, { name: "Corpus private", ownerId: fx.owner.id });
    const input = corpus();
    input.products[0].versions[0].artifacts.push({
      externalId: "secret-screen",
      kind: "screen",
      title: "Secret screen",
      tags: ["secret"],
      rightsClassification: "permitted",
      workspaceId: space.workspace.id,
      ownerSubject: fx.owner.id,
    });
    input.products[0].versions[0].flows.push({
      externalId: "secret-journey",
      title: "Secret journey",
      steps: [{ artifactExternalId: "secret-screen", position: 0 }],
    });
    await importCorpusFixture(fx.db, {
      sourceId: fx.source.id,
      sourceVersion: SOURCE_VERSION,
      corpus: input,
    });
    const inside = await listFlowsForActor(fx.db, { actorId: fx.owner.id });
    assert.equal(inside.total, 2);
    const outside = await listFlowsForActor(fx.db, { actorId: fx.outsider.id });
    assert.equal(outside.total, 1);
    assert.ok(!outside.flows.some((flow) => flow.title === "Secret journey"));
    const hiddenId = inside.flows.find((flow) => flow.title === "Secret journey").flowId;
    await assert.rejects(
      getFlowStepsForActor(fx.db, { flowId: hiddenId, actorId: fx.outsider.id }),
      (error) => error instanceof CorpusError && error.code === "corpus/not-found",
    );
    const owned = await getFlowStepsForActor(fx.db, { flowId: hiddenId, actorId: fx.owner.id });
    assert.equal(owned.steps.length, 1);
  } finally {
    await fx.db.close();
  }
});

test("AF-14a: flow listing filters, paginates, and validates", async () => {
  const fx = await fixture();
  try {
    await importCorpusFixture(fx.db, {
      sourceId: fx.source.id,
      sourceVersion: SOURCE_VERSION,
      corpus: corpus(),
    });
    const listed = await listFlowsForActor(fx.db, { actorId: fx.owner.id });
    const versionId = listed.flows[0].productVersionId;
    const scoped = await listFlowsForActor(fx.db, { actorId: fx.owner.id, productVersionId: versionId });
    assert.equal(scoped.total, 1);
    const page = await listFlowsForActor(fx.db, { actorId: fx.owner.id, limit: 1 });
    assert.equal(page.flows.length, 1);
    assert.equal(page.total, 1);
    await assert.rejects(
      listFlowsForActor(fx.db, { actorId: fx.owner.id, productVersionId: "not-a-uuid" }),
      (error) => error instanceof CorpusError && error.code === "corpus/invalid-input",
    );
    await assert.rejects(
      listFlowsForActor(fx.db, { actorId: fx.owner.id, limit: 51 }),
      (error) => error instanceof CorpusError && error.code === "corpus/invalid-input",
    );
    await assert.rejects(
      getFlowStepsForActor(fx.db, {
        flowId: "00000000-0000-7000-8000-000000000000",
        actorId: fx.owner.id,
      }),
      (error) => error instanceof CorpusError && error.code === "corpus/not-found",
    );
    await assert.rejects(
      getFlowStepsForActor(fx.db, { flowId: "nope", actorId: fx.owner.id }),
      (error) => error instanceof CorpusError && error.code === "corpus/invalid-input",
    );
  } finally {
    await fx.db.close();
  }
});
