import type { DbTransaction } from "./db.ts";

/**
 * AF-12 operations: corpus-subgraph backup, wipe, and restore drill.
 *
 * The production backup mechanism is `pg_dump` plus a filesystem object
 * snapshot (see docs/operations/RUNBOOK.md). This module is the portable
 * verification vehicle for restore correctness: snapshot every row of
 * the corpus subgraph, wipe it, re-insert the exact rows (original IDs
 * preserved, so stable Skelet URIs survive), and verify identity.
 *
 * Scope is deliberately the corpus subgraph (sources, products,
 * product versions, artifacts, flows, flow steps, import records).
 * TRUNCATE ... CASCADE also wipes rows in non-listed tables that
 * reference these rows (for example collection_items cascading from
 * artifacts); the drill runs on scratch databases for exactly this
 * reason. Row-level delete guards (import ledger immutability and
 * reference guards) do not fire on TRUNCATE; a full wipe leaves no
 * dangling references by construction, and row-level takedown uses
 * dedicated paths, never this drill.
 */

export const BACKUP_TABLES = [
  "sources",
  "products",
  "product_versions",
  "artifacts",
  "flows",
  "flow_steps",
  "import_records",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export interface BackupSnapshot {
  version: 1;
  tables: Record<string, Record<string, unknown>[]>;
}

/** Snapshot every row of the corpus subgraph in stable id order. */
export async function snapshotCorpusTables(tx: DbTransaction): Promise<BackupSnapshot> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of BACKUP_TABLES) {
    const result = await tx.query(`select * from ${table} order by id`);
    tables[table] = result.rows as Record<string, unknown>[];
  }
  return { version: 1, tables };
}

/** Wipe the corpus subgraph. Cascades to referencing rows (see above). */
export async function wipeCorpusTables(tx: DbTransaction): Promise<void> {
  await tx.query(`truncate ${BACKUP_TABLES.join(", ")} cascade`);
}

const COLUMN_PATTERN = /^[a-z_][a-z0-9_]*$/;

/**
 * Re-insert snapshot rows with original IDs. Values pass through the
 * driver untouched (timestamptz strings, jsonb objects, uuids); the
 * database assignment casts apply exactly as they did on first write.
 * Column identifiers come from the snapshot file, so they are validated
 * against a strict pattern before interpolation; anything else fails
 * closed instead of reaching SQL.
 */
export async function restoreCorpusTables(tx: DbTransaction, snapshot: BackupSnapshot): Promise<void> {
  if (snapshot.version !== 1 || typeof snapshot.tables !== "object" || snapshot.tables === null) {
    throw new Error("Backup snapshot is invalid.");
  }
  for (const table of BACKUP_TABLES) {
    const rows = snapshot.tables[table];
    if (!Array.isArray(rows)) throw new Error("Backup snapshot is invalid.");
    for (const row of rows) {
      const columns = Object.keys(row);
      if (columns.length === 0 || columns.some((column) => !COLUMN_PATTERN.test(column))) {
        throw new Error("Backup snapshot is invalid.");
      }
      const values = columns.map((column) => {
        const value = (row as Record<string, unknown>)[column];
        return typeof value === "object" && value !== null && !(value instanceof Date) && !Buffer.isBuffer(value as Uint8Array)
          ? JSON.stringify(value)
          : value;
      });
      const placeholders = columns.map((_, index) => `$${index + 1}`);
      await tx.query(
        `insert into ${table} (${columns.join(", ")}) values (${placeholders.join(", ")})`,
        values,
      );
    }
  }
}

export interface RestoreVerification {
  tables: Record<string, { before: number; after: number }>;
  /** True when every table round-tripped row counts and id sets. */
  identical: boolean;
}

/** Verify row counts and id sets match the snapshot per table. */
export async function verifyCorpusRestore(
  tx: DbTransaction,
  snapshot: BackupSnapshot,
): Promise<RestoreVerification> {
  const tables: Record<string, { before: number; after: number }> = {};
  let identical = true;
  for (const table of BACKUP_TABLES) {
    const expected = snapshot.tables[table] ?? [];
    const result = await tx.query(`select id from ${table}`);
    const actual = new Set((result.rows as Record<string, unknown>[]).map((row) => String(row.id)));
    const wanted = new Set(expected.map((row) => String((row as Record<string, unknown>).id)));
    const same = actual.size === wanted.size && [...wanted].every((id) => actual.has(id));
    if (!same) identical = false;
    tables[table] = { before: expected.length, after: actual.size };
    if (tables[table]?.before !== tables[table]?.after) identical = false;
  }
  return { tables, identical };
}
