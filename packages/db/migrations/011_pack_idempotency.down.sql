-- AF-03c rollback: reverse only objects introduced by migration 011.
drop index if exists pack_idempotency_collection_idx;
drop table if exists pack_idempotency;
