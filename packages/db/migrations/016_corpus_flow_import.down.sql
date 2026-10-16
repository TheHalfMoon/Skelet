-- AF-14a rollback: remove flow canonical targets from the import ledger.
-- Precondition: no import_records row may reference canonical_type
-- 'flow'; corpus flow imports are audit-mapped fixtures and are not
-- reconstructed on re-migration.
drop trigger if exists import_flow_guard on flows;

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
    else return false;
  end case;
  return found;
end;
$$;

alter table import_records drop constraint if exists import_records_canonical_type_check;
alter table import_records
  add constraint import_records_canonical_type_check
  check(canonical_type in ('product','product_version','artifact','asset','pattern'));
