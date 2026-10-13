-- AF-07-i: explicit board ordering for collection items.
--
-- Reference boards need stable, author-controlled order; save timestamps
-- alone cannot express moves. Positions are dense zero-based ranks owned
-- by the collection: backfilled in the legacy save order so existing
-- listings read byte-identical after the migration.
alter table collection_items add column position integer not null default 0;
with ranked as (
  select id, row_number() over (
    partition by collection_id order by saved_at, artifact_id
  ) - 1 as rank
  from collection_items
)
update collection_items set position = ranked.rank
from ranked where collection_items.id = ranked.id;
alter table collection_items add constraint collection_item_position_nonnegative
  check (position >= 0);
