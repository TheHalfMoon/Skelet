import { openDatabase, type DbClient } from "../../../packages/db/src/db.ts";

/**
 * Shared database handle for web routes. Reused across requests so the
 * PostgreSQL pool is not churned per call; the local dev fallback
 * (PGlite) likewise boots once. Test and dispatcher code keeps passing
 * explicit handles instead of this singleton.
 *
 * No migrations run here: schema deployment belongs to the operations
 * runbook. An unmigrated database fails closed at the tool layer with
 * an opaque error instead of leaking internals.
 */

let shared: Promise<DbClient> | null = null;

export function getSharedDb(): Promise<DbClient> {
  if (shared === null) {
    const url = process.env.SKELET_MCP_DATABASE_URL;
    shared = openDatabase(url === undefined ? undefined : { connectionString: url }).catch(
      (error: unknown) => {
        shared = null;
        throw error;
      },
    );
  }
  return shared;
}
