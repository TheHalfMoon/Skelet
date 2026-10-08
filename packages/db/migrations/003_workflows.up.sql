-- G03-03: ordered research flows, scoped collections, lifecycle evidence, and replay-safe import identity.
-- No authentication or public collection/read API is activated by this schema.
create table flows (
 id uuid primary key default gen_random_uuid(),
 product_version_id uuid not null references product_versions(id) on delete restrict,
 source_id uuid not null references sources(id) on delete restrict,
 title text not null check(length(trim(title)) > 0),
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata) = 'object'),
 created_at timestamptz not null default now()
);
create index flows_version_idx on flows(product_version_id);
create function skelet_flow_source_guard() returns trigger
language plpgsql set search_path = public,pg_temp as $$
begin
 if tg_op = 'UPDATE' and
   (new.source_id is distinct from old.source_id or
    new.product_version_id is distinct from old.product_version_id) then
   raise exception 'flow identity is immutable';
 end if;
 if not exists(select 1 from product_versions pv join products p on p.id=pv.product_id
   where pv.id=new.product_version_id and p.source_id=new.source_id
    for share of pv,p) then
   raise exception 'flow source must match product version source';
 end if;
 return new;
end;
$$;
create trigger flow_source_guard before insert or update of source_id,product_version_id
 on flows for each row execute function skelet_flow_source_guard();

create table flow_steps (
 id uuid primary key default gen_random_uuid(),
 flow_id uuid not null references flows(id) on delete cascade,
 position integer not null check(position >= 0),
 artifact_id uuid not null references artifacts(id) on delete restrict,
 interaction jsonb check(interaction is null or jsonb_typeof(interaction) = 'object'),
 hotspot jsonb check(hotspot is null or jsonb_typeof(hotspot) = 'object'),
 unique(flow_id,position)
);
create index flow_steps_artifact_idx on flow_steps(artifact_id);

create function skelet_flow_step_integrity() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare expected_version uuid; actual_version uuid; actual_product uuid; expected_product uuid;
        expected_source uuid; actual_source uuid;
begin
 select f.product_version_id,pv.product_id,f.source_id
 into expected_version,expected_product,expected_source
 from flows f join product_versions pv on pv.id=f.product_version_id
 where f.id=new.flow_id for share of f,pv;
 if not found then raise exception 'flow does not exist'; end if;
 select a.product_version_id,a.product_id,a.source_id
 into actual_version,actual_product,actual_source
 from artifacts a where a.id=new.artifact_id for share;
 if not found then raise exception 'flow artifact does not exist'; end if;
 if actual_version is distinct from expected_version
    or actual_product is distinct from expected_product
    or actual_source is distinct from expected_source then
   raise exception 'flow step artifact does not belong to flow product version';
 end if;
 return new;
end;
$$;
create trigger flow_step_integrity before insert or update of flow_id,artifact_id
 on flow_steps for each row execute function skelet_flow_step_integrity();

create table collections (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null,
 owner_subject text not null check(length(trim(owner_subject)) > 0),
 title text not null check(length(trim(title)) > 0),
 visibility text not null default 'private' check(visibility in ('private','workspace')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index collections_workspace_idx on collections(workspace_id);
create table collection_items (
 id uuid primary key default gen_random_uuid(),
 collection_id uuid not null references collections(id) on delete cascade,
 artifact_id uuid not null references artifacts(id) on delete cascade,
 saved_at timestamptz not null default now(),
 unique(collection_id,artifact_id)
);

create table capture_runs (
 id uuid primary key default gen_random_uuid(),
 source_id uuid not null references sources(id) on delete restrict,
 status text not null default 'queued' check(status in ('queued','running','completed','partial','failed','canceled')),
 capture_config jsonb not null default '{}'::jsonb check(jsonb_typeof(capture_config) = 'object'),
 resource_budget jsonb not null default '{}'::jsonb check(jsonb_typeof(resource_budget) = 'object'),
 result_evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(result_evidence) = 'object'),
 error_class text,
 started_at timestamptz,
 finished_at timestamptz,
 created_at timestamptz not null default now(),
 constraint capture_terminal_time check(
  (status in ('completed','partial','failed','canceled') and finished_at is not null)
  or (status in ('queued','running') and finished_at is null)),
 constraint capture_started check(status in ('queued','canceled') or started_at is not null),
 constraint capture_failed_error check(status <> 'failed' or nullif(trim(error_class),'') is not null),
 constraint capture_completed_evidence check(status <> 'completed' or result_evidence <> '{}'::jsonb),
 constraint capture_partial_observation check(status <> 'partial' or result_evidence <> '{}'::jsonb or nullif(trim(error_class),'') is not null),
 constraint capture_timestamp_order check(finished_at is null or started_at is null or finished_at >= started_at)
);
create index capture_source_status_idx on capture_runs(source_id,status);

create table analysis_runs (
 id uuid primary key default gen_random_uuid(),
 source_id uuid not null references sources(id) on delete restrict,
 capture_run_id uuid references capture_runs(id) on delete restrict,
 status text not null default 'queued' check(status in ('queued','running','completed','partial','failed','canceled')),
 provider_kind text not null check(provider_kind in ('deterministic','model')),
 provider_id text,
 model_id text,
 egress_class text not null default 'none' check(egress_class in ('none','local','external')),
 input_evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(input_evidence)='object'),
 result_evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(result_evidence)='object'),
 error_class text,
 started_at timestamptz,
 finished_at timestamptz,
 created_at timestamptz not null default now(),
 constraint analysis_model_identity check(provider_kind <> 'model' or
   (nullif(trim(provider_id),'') is not null and nullif(trim(model_id),'') is not null)),
 constraint analysis_external_provider check(egress_class <> 'external' or nullif(trim(provider_id),'') is not null),
 constraint analysis_terminal_time check(
  (status in ('completed','partial','failed','canceled') and finished_at is not null)
  or (status in ('queued','running') and finished_at is null)),
 constraint analysis_started check(status in ('queued','canceled') or started_at is not null),
 constraint analysis_failed_error check(status <> 'failed' or nullif(trim(error_class),'') is not null),
 constraint analysis_completed_evidence check(status <> 'completed' or result_evidence <> '{}'::jsonb),
 constraint analysis_partial_observation check(status <> 'partial' or result_evidence <> '{}'::jsonb or nullif(trim(error_class),'') is not null),
 constraint analysis_timestamp_order check(finished_at is null or started_at is null or finished_at >= started_at)
);
create unique index capture_source_id_id_uq on capture_runs(source_id,id);
alter table analysis_runs add constraint analysis_capture_source_matches
 foreign key(source_id,capture_run_id) references capture_runs(source_id,id) on delete restrict;
create index analysis_capture_idx on analysis_runs(capture_run_id);

create function skelet_run_insert_guard() returns trigger
language plpgsql set search_path = public,pg_temp as $$
begin
 if new.status <> 'queued' or new.started_at is not null
    or new.finished_at is not null or new.error_class is not null
    or new.result_evidence <> '{}'::jsonb then
    raise exception 'new runs must begin queued with no outcome';
 end if;
 return new;
end;
$$;
create trigger capture_run_insert before insert on capture_runs
 for each row execute function skelet_run_insert_guard();
create trigger analysis_run_insert before insert on analysis_runs
 for each row execute function skelet_run_insert_guard();
create function skelet_run_transition_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
 if old.status in ('completed','partial','failed','canceled') then
   raise exception 'terminal run cannot be modified';
 end if;
 if (to_jsonb(new) - array['status','started_at','finished_at','result_evidence','error_class']) is distinct from
    (to_jsonb(old) - array['status','started_at','finished_at','result_evidence','error_class']) then
   raise exception 'run identity is immutable';
 end if;
 if new.status = old.status then
   if to_jsonb(new) is distinct from to_jsonb(old) then
     raise exception 'run state evidence cannot change without transition';
   end if;
   return new;
 end if;
 if old.status = 'queued' and new.status = 'running' then
   if new.started_at is null or new.finished_at is not null
      or new.error_class is not null or new.result_evidence <> '{}'::jsonb then
      raise exception 'running transition must start without outcome';
   end if;
 end if;
 if new.status in ('completed','partial','failed','canceled') and new.finished_at is null then
   raise exception 'terminal transition needs finish timestamp';
 end if;
 if old.status = 'queued' and new.status in ('running','canceled') then return new; end if;
 if old.status = 'running' and new.status in ('completed','partial','failed','canceled') then return new; end if;
 raise exception 'invalid run state transition';
end;
$$;
create trigger capture_run_transition before update on capture_runs
 for each row execute function skelet_run_transition_guard();
create trigger analysis_run_transition before update on analysis_runs
 for each row execute function skelet_run_transition_guard();

create table import_records (
 id uuid primary key default gen_random_uuid(),
 source_id uuid not null references sources(id) on delete restrict,
 external_id text not null check(length(trim(external_id)) > 0),
 source_version text not null check(length(trim(source_version)) > 0),
 canonical_type text not null check(canonical_type in ('product','product_version','artifact','asset','pattern')),
 canonical_id uuid not null,
 imported_at timestamptz not null default now(),
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata) = 'object'),
 unique(source_id,external_id,source_version)
);
create index import_records_canonical_idx on import_records(canonical_type,canonical_id);
create function skelet_import_target_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
 if not skelet_graph_ref_exists(new.canonical_type,new.canonical_id) then
   raise exception 'import canonical target not found';
 end if;
 return new;
end;
$$;
-- AFTER INSERT prevents BEFORE triggers from rejecting an idempotent
-- ON CONFLICT DO NOTHING before its existing mapping can be checked.
create trigger import_target_guard after insert
 on import_records for each row execute function skelet_import_target_guard();
create function skelet_import_immutable() returns trigger
language plpgsql set search_path = public,pg_temp as $$
begin
 raise exception 'import records are immutable';
end;
$$;
create trigger import_immutable_guard before update or delete on import_records
 for each row execute function skelet_import_immutable();

-- Preserve import-record referential integrity when canonical targets are removed.
create function skelet_import_ref_delete_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
 if exists(select 1 from import_records
     where canonical_type=TG_ARGV[0] and canonical_id=old.id)
 then raise exception 'canonical target has import records'; end if;
 return old;
end;
$$;
create trigger import_product_guard before delete on products for each row
 execute function skelet_import_ref_delete_guard('product');
create trigger import_version_guard before delete on product_versions for each row
 execute function skelet_import_ref_delete_guard('product_version');
create trigger import_artifact_guard before delete on artifacts for each row
 execute function skelet_import_ref_delete_guard('artifact');
create trigger import_asset_guard before delete on assets for each row
 execute function skelet_import_ref_delete_guard('asset');
create trigger import_pattern_guard before delete on patterns for each row
 execute function skelet_import_ref_delete_guard('pattern');

-- Canonical flow references cannot drift when referenced parent identities change.
create function skelet_flow_parent_guard() returns trigger
language plpgsql set search_path = public,pg_temp as $$
begin
 if TG_ARGV[0]='artifact' then
  if (new.product_id is distinct from old.product_id or
      new.product_version_id is distinct from old.product_version_id or
      new.source_id is distinct from old.source_id)
     and exists(select 1 from flow_steps where artifact_id=old.id) then
    raise exception 'flow step artifact identity is immutable';
  end if;
 elsif TG_ARGV[0]='product_version' then
  if new.product_id is distinct from old.product_id and
     exists(select 1 from flows where product_version_id=old.id) then
    raise exception 'flow product version identity is immutable';
  end if;
 elsif TG_ARGV[0]='product' then
  if new.source_id is distinct from old.source_id and exists(
     select 1 from product_versions pv join flows f on f.product_version_id=pv.id
     where pv.product_id=old.id) then
    raise exception 'flow product source identity is immutable';
  end if;
 end if;
 return new;
end;
$$;
create trigger flow_artifact_parent_guard before update of product_id,product_version_id,source_id on artifacts
 for each row execute function skelet_flow_parent_guard('artifact');
create trigger flow_version_parent_guard before update of product_id on product_versions
 for each row execute function skelet_flow_parent_guard('product_version');
create trigger flow_product_parent_guard before update of source_id on products
 for each row execute function skelet_flow_parent_guard('product');
