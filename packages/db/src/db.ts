import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";

export interface DbQueryResult {
  rows: Record<string, unknown>[];
}

/** Operations allowed inside a pinned database transaction. */
export interface DbTransaction {
  query(text: string, params?: readonly unknown[]): Promise<DbQueryResult>;
  exec(text: string): Promise<void>;
}

/** Explicit transaction boundary; pool queries must never be used for BEGIN/COMMIT. */
export interface DbClient extends DbTransaction {
  transaction<T>(
    work: (tx: DbTransaction) => Promise<T>,
    options?: { migrationLock?: boolean },
  ): Promise<T>;
  close(): Promise<void>;
}

class PGliteClient implements DbClient {
  private readonly db: PGlite;
  constructor(db: PGlite) { this.db = db; }

  async query(text: string, params?: readonly unknown[]): Promise<DbQueryResult> {
    const result = await this.db.query<Record<string, unknown>>(
      text,
      params as unknown[] | undefined,
    );
    return { rows: result.rows };
  }

  async exec(text: string): Promise<void> {
    await this.db.exec(text);
  }

  async transaction<T>(work: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (client) =>
      work({
        query: async (text, params) => ({
          rows: (await client.query<Record<string, unknown>>(
            text,
            params as unknown[] | undefined,
          )).rows,
        }),
        exec: async (text) => { await client.exec(text); },
      }),
    );
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

export class PgPoolClient implements DbClient {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async query(text: string, params?: readonly unknown[]): Promise<DbQueryResult> {
    const result = await this.pool.query(text, params as unknown[]);
    return { rows: result.rows as Record<string, unknown>[] };
  }

  async exec(text: string): Promise<void> {
    await this.pool.query(text);
  }

  async transaction<T>(
    work: (tx: DbTransaction) => Promise<T>,
    options?: { migrationLock?: boolean },
  ): Promise<T> {
    const client = await this.pool.connect();
    let started = false;
    try {
      await client.query("BEGIN");
      started = true;
      // Serialize only schema migrations; normal application transactions remain independent.
      if (options?.migrationLock) {
        await client.query("SELECT pg_advisory_xact_lock($1)", [8734352]);
      }
      const tx: DbTransaction = {
        query: async (text, params) => ({
          rows: (await client.query(text, params as unknown[])).rows as Record<string, unknown>[],
        }),
        exec: async (text) => { await client.query(text); },
      };
      const value = await work(tx);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      if (started) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Database transaction and rollback failed");
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** No paid service needed: use embedded PGlite unless PostgreSQL is configured. */
export async function openDatabase(options?: {
  connectionString?: string;
  dataDir?: string;
}): Promise<DbClient> {
  if (options?.connectionString) {
    const pool = new Pool({ connectionString: options.connectionString });
    try {
      await pool.query("select 1");
    } catch (error) {
      await pool.end();
      throw error;
    }
    return new PgPoolClient(pool);
  }
  return new PGliteClient(new PGlite(options?.dataDir));
}
