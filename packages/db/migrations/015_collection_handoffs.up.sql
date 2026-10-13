-- AF-09-i: ownership handoff ledger for reference boards.
--
-- Handoffs move collection ownership between workspace members with a
-- durable provenance chain. The ledger is append-only: rows reference
-- the collection with cascade delete, and no update or delete path
-- exists for handoff records.
create table collection_handoffs (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references collections(id) on delete cascade,
  from_subject text not null check(length(trim(from_subject)) > 0),
  to_subject text not null check(length(trim(to_subject)) > 0),
  actor_id text not null check(length(trim(actor_id)) > 0),
  created_at timestamptz not null default now()
);
create index collection_handoffs_collection_idx on collection_handoffs(collection_id);
