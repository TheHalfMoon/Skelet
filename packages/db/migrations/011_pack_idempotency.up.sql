-- AF-03c: agent write idempotency ledger for reference packs.
-- Maps (user_id, idempotency_key) to the canonical collection created for
-- that key so safe retries of create_reference_pack return the same
-- skelet://collection/{id} instead of duplicating canonical state.
-- save_reference needs no ledger: it is idempotent via ON CONFLICT.
create table pack_idempotency (
 user_id text not null
  check(length(trim(user_id)) > 0 and char_length(user_id) <= 128),
 idempotency_key text not null
  check(length(trim(idempotency_key)) > 0 and char_length(idempotency_key) <= 128),
 collection_id uuid not null references collections(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key (user_id, idempotency_key)
);
create index pack_idempotency_collection_idx on pack_idempotency(collection_id);
