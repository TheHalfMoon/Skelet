-- AF-14a: admit flow canonical targets in the import ledger.
--
-- Corpus flows need the same idempotent external-identity mapping as
-- products, versions, and artifacts. The ledger CHECK and the graph
-- reference guard enumerate canonical types explicitly, so both are
-- extended here. Nothing else changes: the immutability guard, the
-- target guard, and the per-table delete guards keep working.
alter table import_records drop constraint if exists import_records_canonical_type_check;
alter table import_records
  add constraint import_records_canonical_type_check
  check(canonical_type in ('product','product_version','artifact','asset','pattern','flow'));

create or replace function skilit_graph_ref_exists(ref_kind text, ref_id uuid)
returns boolean language plpgsql volatile as $$
begin
  -- Lock endpoint rows until the insertion commits so a concurrent DELETE
  -- cannot race this validation and leave a dangling relation.
  case ref_kind
    when 'source' then perform 1 from sources where id=ref_id for key share;
    when 'product' then perform 1 from products where id=ref_id for key share;
    when 'product_version' then perform 1 from product_versions where id=ref_id for key share;
    when 'artifact' then perform 1 from artifacts where id=ref_id for key share;
    when 'asset' then perform 1 from assets where id=ref_id for key share;
    when 'pattern' then perform 1 from patterns where id=ref_id for key share;
    when 'flow' then perform 1 from flows where id=ref_id for key share;
    else return false;
  end case;
  return found;
end;
$$;

create trigger import_flow_guard before delete on flows for each row
 execute function skilit_import_ref_delete_guard('flow');
