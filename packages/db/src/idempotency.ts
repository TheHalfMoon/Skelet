import type { DbTransaction } from "./db.ts";

/**
 * AF-03c pack write idempotency ledger.
 *
 * save_reference needs no ledger: re-saving the same (collection,
 * artifact) pair is a no-op via ON CONFLICT. create_reference_pack
 * creates a new collection per call, so retries without a key would
 * duplicate canonical state. When the client supplies an idempotency
 * key, the first call claims (user_id, key) -> collection_id and later
 * calls with the same pair return the same collection instead of
 * creating a new one. Keys are per-user so one actor can never recover
 * another actor's pack through a guessed key.
 */

export async function findPackForIdempotencyKey(
  tx: DbTransaction,
  userId: string,
  key: string,
): Promise<string | null> {
  const result = await tx.query(
    "select collection_id from pack_idempotency where user_id = $1 and idempotency_key = $2",
    [userId, key],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return String(row.collection_id);
}

export async function claimPackIdempotency(
  tx: DbTransaction,
  userId: string,
  key: string,
  collectionId: string,
): Promise<void> {
  await tx.query(
    `insert into pack_idempotency (user_id, idempotency_key, collection_id)
     values ($1, $2, $3) on conflict (user_id, idempotency_key) do nothing`,
    [userId, key, collectionId],
  );
}
