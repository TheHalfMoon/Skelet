import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/db.ts";
import { migrateDown, migrateUp } from "../src/migrate.ts";
import { createSource } from "../src/repositories.ts";

/**
 * AF-12 release evidence (i): migration rehearsal.
 *
 * Full up/down/up cycle on a scratch database. Proves the release can
 * migrate forward, roll every migration back in exact reverse order with
 * an empty ledger and dropped tables, then migrate forward again onto a
 * schema that serves writes. Counts are asserted as exact up/down
 * symmetry (not hardcoded totals) so the rehearsal survives future
 * migrations without false passes or false failures.
 */
test("AF-12-release: full migration rehearsal up/down/up serves writes", async () => {
  const db = await openDatabase();
  try {
    const first = await migrateUp(db);
    assert.ok(first.length >= 16, `expected at least 16 migrations, got ${first.length}`);

    const ledger = await db.query("select filename from schema_migrations order by filename");
    assert.deepEqual(
      ledger.rows.map((row) => row.filename),
      [...first].sort(),
    );

    // The migrated schema serves writes before rollback.
    const before = await createSource(db, { key: "rehearsal-before", kind: "synthetic" });
    assert.ok(before.id);

    const down = await migrateDown(db);
    assert.deepEqual(down, [...first].reverse());

    const emptied = await db.query("select filename from schema_migrations");
    assert.equal(emptied.rows.length, 0);
    for (const table of ["sources", "products", "artifacts", "flows"]) {
      const check = await db.query("select to_regclass($1) as oid", [`public.${table}`]);
      assert.equal(check.rows[0]?.oid, null, `table ${table} should be dropped after full rollback`);
    }

    const second = await migrateUp(db);
    assert.deepEqual(second, first);

    // The reheated schema serves writes again.
    const after = await createSource(db, { key: "rehearsal-after", kind: "synthetic" });
    assert.ok(after.id);
  } finally {
    await db.close();
  }
});
