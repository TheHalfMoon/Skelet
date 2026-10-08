import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { DbClient, DbTransaction } from "./db.ts";

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("../package.json"));
const MIGRATIONS_DIR = join(packageRoot, "migrations");

function upMigrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".up.sql"))
    .sort()
    .map((file) => ({
      name: file.replace(/\.up\.sql$/, ""),
      sql: readFileSync(join(MIGRATIONS_DIR, file), "utf-8"),
    }));
}

function downSql(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name + ".down.sql"), "utf-8");
}

async function ensureLedger(tx: DbTransaction): Promise<void> {
  await tx.query(
    "create table if not exists schema_migrations (" +
      "filename text primary key, applied_at timestamptz not null default now())",
  );
}

async function isApplied(tx: DbTransaction, name: string): Promise<boolean> {
  const result = await tx.query(
    "select 1 from schema_migrations where filename = $1",
    [name],
  );
  return result.rows.length > 0;
}

/**
 * Apply pending migrations atomically. Check the ledger *inside* the same
 * transaction as DDL and ledger insertion, guarded by the PG advisory lock.
 */
export async function migrateUp(client: DbClient): Promise<string[]> {
  const applied: string[] = [];
  for (const migration of upMigrations()) {
    const changed = await client.transaction(async (tx) => {
      await ensureLedger(tx);
      if (await isApplied(tx, migration.name)) return false;
      await tx.exec(migration.sql);
      await tx.query(
        "insert into schema_migrations (filename) values ($1)",
        [migration.name],
      );
      return true;
    }, { migrationLock: true });
    if (changed) applied.push(migration.name);
  }
  return applied;
}

/** Roll back applied migrations atomically, in reverse order. */
export async function migrateDown(client: DbClient): Promise<string[]> {
  const rolledBack: string[] = [];
  for (const migration of upMigrations().reverse()) {
    const changed = await client.transaction(async (tx) => {
      await ensureLedger(tx);
      if (!(await isApplied(tx, migration.name))) return false;
      await tx.exec(downSql(migration.name));
      await tx.query(
        "delete from schema_migrations where filename = $1",
        [migration.name],
      );
      return true;
    }, { migrationLock: true });
    if (changed) rolledBack.push(migration.name);
  }
  return rolledBack;
}
