-- G05-01: PostgreSQL-backed job queue with identity, scheduling,
-- retry/backoff, cancellation, and dead-letter state. Providers and
-- worker runtimes arrive in later grains; this schema is the durable
-- lifecycle they share. No public API is activated here.
create table jobs (
 id uuid primary key default gen_random_uuid(),
 queue text not null
  check(length(trim(queue)) > 0 and char_length(queue) <= 128),
 kind text not null
  check(length(trim(kind)) > 0 and char_length(kind) <= 128),
 payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload) = 'object'),
 status text not null default 'queued'
  check(status in ('queued', 'running', 'completed', 'failed', 'canceled', 'dead')),
 idempotency_key text unique
  check(idempotency_key is null or
   (length(trim(idempotency_key)) > 0 and char_length(idempotency_key) <= 256)),
 attempts integer not null default 0 check(attempts >= 0),
 max_attempts integer not null default 5 check(max_attempts >= 1),
 run_at timestamptz not null default now(),
 locked_by text,
 locked_at timestamptz,
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index jobs_claim_idx on jobs(queue, status, run_at);

create function skelet_jobs_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
 new.updated_at = now();
 return new;
end;
$$;
create trigger jobs_updated_at before update on jobs
 for each row execute function skelet_jobs_updated_at();
