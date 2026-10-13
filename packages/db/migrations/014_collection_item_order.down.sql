-- AF-07-i rollback: drop explicit board ordering.
-- Precondition: no consumer depends on position (it is ignored once the
-- column is gone; listings revert to save order).
alter table collection_items drop constraint collection_item_position_nonnegative;
alter table collection_items drop column position;
