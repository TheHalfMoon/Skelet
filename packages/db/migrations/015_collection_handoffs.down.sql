-- AF-09-i rollback: drop the handoff ledger.
-- Precondition: none beyond the cascade; handoff history is audit data
-- and is not reconstructed on re-migration.
drop table collection_handoffs;
