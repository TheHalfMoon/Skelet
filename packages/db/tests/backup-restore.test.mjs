import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../db/src/db.ts";
import { migrateUp } from "../../db/src/migrate.ts";
import { createSource } from "../../db/src/repositories.ts";
import { signUp } from "../../db/src/auth.ts";
import { importCorpusFixture, listFlowsForActor } from "../../ingest/src/corpus.ts";
import {
  restoreCorpusTables,
  snapshotCorpusTables,
  verifyCorpusRestore,
  wipeCorpusTables,
} from "../src/backup.ts";

function corpus() {
  return {
    products: [
      {
        externalId: "drill-shop",
        title: "Drill Shop",
        versions: [
          {
            versionNo: 1,
            artifacts: [
              {
                externalId: "drill-home",
                kind: "screen",
                title: "Drill home",
                tags: ["home"],
                rightsClassification: "permitted",
              },
              {
                externalId: "drill-pay",
                kind: "screen",
                title: "Drill pay",
                tags: ["pay"],
                rightsClassification: "permitted",
              },
            ],
            flows: [
              {
                externalId: "drill-buy",
                title: "Drill buy",
                steps: [
                  { artifactExternalId: "drill-home", position: 0 },
                  { artifactExternalId: "drill-pay", position: 1 },
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
  const owner = await signUp(db, { email: "drill-owner@skelet.example", password: "drill-password-01" });
  const source = await createSource(db, { key: "drill-source", kind: "synthetic" });
  await importCorpusFixture(db, { sourceId: source.id, sourceVersion: "drill-1", corpus: corpus() });
  return { db, owner, source };
}

test("AF-12-ops: snapshot, wipe, restore round-trips the corpus subgraph", async () => {
  const fx = await fixture();
  try {
    const snapshot = await snapshotCorpusTables(fx.db);
    assert.equal(snapshot.version, 1);
    assert.ok((snapshot.tables.artifacts ?? []).length >= 2);
    await wipeCorpusTables(fx.db);
    const empty = await snapshotCorpusTables(fx.db);
    for (const rows of Object.values(empty.tables)) assert.deepEqual(rows, []);
    const listed = await listFlowsForActor(fx.db, { actorId: fx.owner.id });
    assert.equal(listed.total, 0);
    await restoreCorpusTables(fx.db, snapshot);
    const verification = await verifyCorpusRestore(fx.db, snapshot);
    assert.equal(verification.identical, true);
    for (const table of Object.keys(snapshot.tables)) {
      assert.equal(verification.tables[table]?.before, verification.tables[table]?.after);
    }
    // Reads work again with identical stable identities.
    const recovered = await listFlowsForActor(fx.db, { actorId: fx.owner.id });
    assert.equal(recovered.total, 1);
    assert.equal(recovered.flows[0]?.stepCount, 2);
    // Restoring twice without a wipe fails closed on primary keys instead
    // of duplicating rows; the corpus stays exactly as verified.
    await assert.rejects(restoreCorpusTables(fx.db, snapshot));
    const reverified = await verifyCorpusRestore(fx.db, snapshot);
    assert.equal(reverified.identical, true);
  } finally {
    await fx.db.close();
  }
});

test("AF-12-ops: invalid snapshots fail closed", async () => {
  const fx = await fixture();
  try {
    await assert.rejects(restoreCorpusTables(fx.db, { version: 2, tables: {} }));
    await assert.rejects(restoreCorpusTables(fx.db, { version: 1, tables: { sources: "nope" } }));
    await assert.rejects(
      restoreCorpusTables(fx.db, { version: 1, tables: { sources: [{ 'id"); DROP TABLE sources; --': "x" }] } }),
    );
    // The failed restores wrote nothing: the corpus still reads intact.
    const listed = await listFlowsForActor(fx.db, { actorId: fx.owner.id });
    assert.equal(listed.total, 1);
  } finally {
    await fx.db.close();
  }
});
