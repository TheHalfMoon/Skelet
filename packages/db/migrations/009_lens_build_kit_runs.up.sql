-- G09b-02: Lens Build Kit AnalysisRun job lifecycle foundation.
-- Durable nine-state lifecycle (queued, capturing, extracting, generating,
-- validating, completed, partial, failed, canceled) bound to the frozen
-- skelet.lens.build-kit.v1 manifest contract. Tenant-scoped identities,
-- idempotent submission, optimistic-concurrency revisions, worker leases,
-- quota ledger, and retention/expiry. No public API is activated here;
-- service operations live in packages/db/src/build-kit.ts.
create table lens_build_kit_runs (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references workspaces(id) on delete restrict,
 kit_id text not null unique
  check(kit_id ~ '^[0-9a-f]{64}$'),
 analysis_id text not null
  check(analysis_id ~ '^[0-9a-f]{64}$'),
 status text not null default 'queued'
  check(status in ('queued', 'capturing', 'extracting', 'generating',
   'validating', 'completed', 'partial', 'failed', 'canceled')),
 revision integer not null default 0 check(revision >= 0),
 idempotency_key text not null
  check(length(trim(idempotency_key)) > 0 and char_length(idempotency_key) <= 256),
 request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 request_body jsonb not null default '{}'::jsonb
  check(jsonb_typeof(request_body) = 'object'),
 scope_budgets jsonb not null default '{}'::jsonb
  check(jsonb_typeof(scope_budgets) = 'object'),
 attempt integer not null default 0 check(attempt >= 0),
 max_attempts integer not null default 3
  check(max_attempts >= 1 and max_attempts <= 5),
 attempt_history jsonb not null default '[]'::jsonb
  check(jsonb_typeof(attempt_history) = 'array'),
 checkpoint jsonb check(checkpoint is null or jsonb_typeof(checkpoint) = 'object'),
 result_evidence jsonb not null default '{}'::jsonb
  check(jsonb_typeof(result_evidence) = 'object'),
 artifact_manifest jsonb not null default '{}'::jsonb
  check(jsonb_typeof(artifact_manifest) = 'object'),
 error_class text
  check(error_class is null or
   (length(trim(error_class)) > 0 and char_length(error_class) <= 200)),
 lease_owner text
  check(lease_owner is null or
   (length(trim(lease_owner)) > 0 and char_length(lease_owner) <= 128)),
 lease_expires_at timestamptz,
 expires_at timestamptz not null,
 purged_at timestamptz,
 started_at timestamptz,
 finished_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id, idempotency_key),
 constraint kit_run_lease_pair check(
  (lease_owner is null and lease_expires_at is null) or
  (lease_owner is not null and lease_expires_at is not null)),
 constraint kit_run_terminal_time check(
  (status in ('completed', 'partial', 'failed', 'canceled') and finished_at is not null) or
  (status in ('queued', 'capturing', 'extracting', 'generating', 'validating') and finished_at is null)),
 constraint kit_run_started check(
  status in ('queued', 'canceled') or started_at is not null),
 constraint kit_run_completed_artifacts check(
  status <> 'completed' or artifact_manifest <> '{}'::jsonb),
 constraint kit_run_failed_error check(
  status <> 'failed' or nullif(trim(error_class), '') is not null),
 constraint kit_run_partial_observation check(
  status <> 'partial' or
  result_evidence <> '{}'::jsonb or nullif(trim(error_class), '') is not null),
 constraint kit_run_timestamp_order check(
  finished_at is null or started_at is null or finished_at >= started_at),
 constraint kit_run_purge_payload check(
  purged_at is null or (artifact_manifest = '{}'::jsonb and checkpoint is null))
);
create index lens_kit_runs_workspace_status_idx
 on lens_build_kit_runs(workspace_id, status);
create index lens_kit_runs_expires_idx
 on lens_build_kit_runs(expires_at) where purged_at is null;

-- Per-workspace quota ledger. Counters move only inside the same
-- transaction as the lifecycle transition they account for, so a crash
-- never charges without a run and never releases without a terminal write.
create table lens_build_kit_quotas (
 workspace_id uuid primary key references workspaces(id) on delete cascade,
 submitted_total integer not null default 0 check(submitted_total >= 0),
 active_count integer not null default 0 check(active_count >= 0),
 pages_reserved integer not null default 0 check(pages_reserved >= 0),
 bytes_reserved bigint not null default 0 check(bytes_reserved >= 0),
 updated_at timestamptz not null default now()
);

create function skelet_kit_run_transition_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
 if tg_op = 'INSERT' then
  if new.status <> 'queued' or new.revision <> 0 or new.attempt <> 0
     or new.started_at is not null or new.finished_at is not null
     or new.error_class is not null or new.lease_owner is not null
     or new.lease_expires_at is not null or new.purged_at is not null
     or new.result_evidence <> '{}'::jsonb
     or new.artifact_manifest <> '{}'::jsonb
     or new.attempt_history <> '[]'::jsonb then
   raise exception 'new kit runs must begin queued with no outcome';
  end if;
  return new;
 end if;
 -- Terminal rows are immutable except the audited expiry purge, which
 -- clears payload columns while preserving status, error, history, and
 -- identity, and except explicit retry requeue of failed/partial runs
 -- (attempt budget and history are enforced in application code).
 -- Idempotent terminal re-application is resolved in application code
 -- before reaching this trigger.
 if old.status in ('completed', 'partial', 'failed', 'canceled') then
  if new.status = old.status and old.purged_at is null
     and new.purged_at is not null
     and new.artifact_manifest = '{}'::jsonb and new.checkpoint is null
     and new.result_evidence = '{}'::jsonb then
   if new.revision <> old.revision + 1 then
    raise exception 'kit run revision must advance by exactly one';
   end if;
   return new;
  end if;
  if (old.status = 'failed' or old.status = 'partial') and new.status = 'queued' then
   if new.finished_at is not null then
    raise exception 'retried kit run must clear finish timestamp';
   end if;
   if new.revision <> old.revision + 1 then
    raise exception 'kit run revision must advance by exactly one';
   end if;
   return new;
  end if;
  raise exception 'terminal kit run cannot be modified';
 end if;
 if (to_jsonb(new) - array['status', 'revision', 'attempt', 'attempt_history',
     'checkpoint', 'result_evidence', 'artifact_manifest', 'error_class',
     'lease_owner', 'lease_expires_at', 'purged_at', 'started_at',
     'finished_at', 'updated_at'])
    is distinct from
    (to_jsonb(old) - array['status', 'revision', 'attempt', 'attempt_history',
     'checkpoint', 'result_evidence', 'artifact_manifest', 'error_class',
     'lease_owner', 'lease_expires_at', 'purged_at', 'started_at',
     'finished_at', 'updated_at']) then
  raise exception 'kit run identity is immutable';
 end if;
 if new.revision <> old.revision + 1 then
  raise exception 'kit run revision must advance by exactly one';
 end if;
 if new.status = old.status then
  -- Same-state refresh (lease renewal, checkpoint progress) keeps
  -- outcome columns terminal-consistent via table constraints.
  return new;
 end if;
 if old.status = 'queued' and new.status in ('capturing', 'canceled') then
  if new.status = 'capturing' and
     (new.started_at is null or new.finished_at is not null
      or new.error_class is not null
      or new.result_evidence <> '{}'::jsonb
      or new.artifact_manifest <> '{}'::jsonb) then
   raise exception 'capture start must carry no outcome';
  end if;
  return new;
 end if;
 if old.status = 'capturing' and new.status in ('extracting', 'failed', 'canceled') then return new; end if;
 if old.status = 'extracting' and new.status in ('generating', 'failed', 'canceled') then return new; end if;
 if old.status = 'generating' and new.status in ('validating', 'partial', 'failed', 'canceled') then return new; end if;
 if old.status = 'validating' and new.status in ('completed', 'partial', 'failed', 'canceled') then return new; end if;
 raise exception 'invalid kit run state transition';
end;
$$;
create trigger lens_kit_run_insert before insert on lens_build_kit_runs
 for each row execute function skelet_kit_run_transition_guard();
create trigger lens_kit_run_transition before update on lens_build_kit_runs
 for each row execute function skelet_kit_run_transition_guard();

create function skelet_kit_runs_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
 new.updated_at = now();
 return new;
end;
$$;
create trigger lens_kit_runs_updated_at before update on lens_build_kit_runs
 for each row execute function skelet_kit_runs_updated_at();
