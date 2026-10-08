import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../src/db.ts";
import { migrateDown } from "../src/migrate.ts";

const connectionString = process.env.SKELET_TEST_DATABASE_URL;
const enabled = Boolean(connectionString);

/** Never run destructive migrations against a non-fixture database. */
function requireFixtureDatabase() {
  if (!connectionString || process.env.SKELET_DB_TEST_CONFIRM !== "yes") {
    throw new Error("Explicit fixture database confirmation is required");
  }
  const url = new URL(connectionString);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/skelet_test" ||
    url.username !== "skelet_test"
  ) {
    throw new Error("Refusing integration tests against a non-local/non-fixture database");
  }
}

function spawnMigrator() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        fileURLToPath(new URL("./pg-migrate-worker.mjs", import.meta.url)),
      ],
      {
        env: { ...process.env },
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error("Migrator process failed: " + stderr));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error("Migrator did not produce valid JSON: " + String(error)));
      }
    });
  });
}

test("real PostgreSQL serializes two independent migration processes", { skip: !enabled }, async () => {
  requireFixtureDatabase();
  const results = await Promise.all([spawnMigrator(), spawnMigrator()]);
  assert.deepEqual(
    results.flat().sort(),
    ["001_sources_products"],
    "Only one process must apply the migration",
  );

  const db = await openDatabase({ connectionString });
  try {
    const ledger = await db.query(
      "select filename from schema_migrations order by filename",
    );
    assert.deepEqual(ledger.rows.map((row) => row.filename), ["001_sources_products"]);
    for (const table of ["sources", "products", "product_versions"]) {
      const result = await db.query("select to_regclass($1) as oid", ["public." + table]);
      assert.notEqual(result.rows[0]?.oid, null);
    }
  } finally {
    await migrateDown(db);
    await db.close();
  }
});

test("real PostgreSQL transaction rolls back DDL and releases its connection", { skip: !enabled }, async () => {
  requireFixtureDatabase();
  const db = await openDatabase({ connectionString });
  try {
    await assert.rejects(
      () => db.transaction(async (tx) => {
        await tx.exec("create table rollback_probe (id integer primary key)");
        await tx.exec("insert into rollback_probe (id) values (1)");
        throw new Error("forced PostgreSQL rollback");
      }),
      /forced PostgreSQL rollback/,
    );
    const check = await db.query("select to_regclass('public.rollback_probe') as oid");
    assert.equal(check.rows[0]?.oid, null);
  } finally {
    await db.close();
  }
});
