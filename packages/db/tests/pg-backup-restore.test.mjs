import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/db.ts";
import { migrateUp } from "../src/migrate.ts";
import { createSource } from "../src/repositories.ts";
import { signUp } from "../src/auth.ts";
import { importCorpusFixture, listFlowsForActor } from "../../ingest/src/corpus.ts";
import {
  restoreCorpusTables,
  snapshotCorpusTables,
  verifyCorpusRestore,
  wipeCorpusTables,
} from "../src/backup.ts";

const connectionString = process.env.SKILIT_TEST_DATABASE_URL;
const enabled = Boolean(connectionString);

/** Never run the destructive wipe drill against a non-fixture database. */
function requireFixtureDatabase() {
  if (!connectionString || process.env.SKILIT_DB_TEST_CONFIRM !== "yes") {
    throw new Error("Explicit fixture database confirmation is required");
  }
  const url = new URL(connectionString);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/skilit_test" ||
    url.username !== "skilit_test"
  ) {
    throw new Error("Refusing integration tests against a non-local/non-fixture database");
  }
}

test("AF-12-ops: real PostgreSQL corpus backup round-trip preserves identities", { skip: !enabled }, async () => {
  requireFixtureDatabase();
  const db = await openDatabase({ databaseUrl: connectionString });
  try {
    await migrateUp(db);
    const owner = await signUp(db, {
      email: `pg-drill-${Date.now()}@skilit.example`,
      password: "drill-password-01",
    });
    const source = await createSource(db, { key: `pg-drill-source-${Date.now()}`, kind: "synthetic" });
    const corpus = {
      products: [
        {
          externalId: "pg-drill-shop",
          title: "PG Drill Shop",
          versions: [
            {
              versionNo: 1,
              artifacts: [
                {
                  externalId: "pg-drill-home",
                  kind: "screen",
                  title: "PG Drill home",
                  tags: ["home"],
                  rightsClassification: "permitted",
                },
              ],
              flows: [
                {
                  externalId: "pg-drill-buy",
                  title: "PG Drill buy",
                  steps: [{ artifactExternalId: "pg-drill-home", position: 0 }],
                },
              ],
            },
          ],
        },
      ],
    };
    await importCorpusFixture(db, { sourceId: source.id, sourceVersion: "pg-drill-1", corpus });
    const snapshot = await snapshotCorpusTables(db);
    const beforeIds = (snapshot.tables.artifacts ?? []).map((row) => String(row.id)).sort();
    await wipeCorpusTables(db);
    assert.equal((await listFlowsForActor(db, { actorId: owner.id })).total, 0);
    await restoreCorpusTables(db, snapshot);
    const verification = await verifyCorpusRestore(db, snapshot);
    assert.equal(verification.identical, true);
    const recovered = await listFlowsForActor(db, { actorId: owner.id });
    assert.ok(recovered.total >= 1);
    const afterIds = (snapshot.tables.artifacts ?? []).map((row) => String(row.id)).sort();
    assert.deepEqual(afterIds, beforeIds);
  } finally {
    await db.close();
  }
});
