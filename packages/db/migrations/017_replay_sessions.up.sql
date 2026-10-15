-- P10-D1: consented replay-event ledger for newly captured web flows.
--
-- rrweb-compatible event sequences are recorded per flow through explicit
-- sessions, never implicitly. Sessions carry the opening actor, the owning
-- workspace (when workspace-scoped), and the consent record; events carry
-- a deterministic per-session sequence. Replay reads the same rows back in
-- sequence order. No donor code is vendored; the event envelope shape
-- (type/timestamp/data) mirrors the rrweb event contract without importing
-- it. Redaction happens in the Skelet-owned record path, not in storage.
create table replay_sessions (
 id uuid primary key default gen_random_uuid(),
 flow_id uuid not null references flows(id) on delete cascade,
 workspace_id uuid references workspaces(id) on delete cascade,
 opened_by text not null check(length(trim(opened_by)) > 0),
 consent text not null check(consent = 'explicit'),
 status text not null default 'open' check(status in ('open','closed')),
 event_count integer not null default 0 check(event_count >= 0),
 byte_count bigint not null default 0 check(byte_count >= 0),
 opened_at timestamptz not null default now(),
 closed_at timestamptz
);
create index replay_sessions_flow_idx on replay_sessions(flow_id);

create table replay_events (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references replay_sessions(id) on delete cascade,
 seq integer not null check(seq >= 0),
 event jsonb not null check(jsonb_typeof(event) = 'object'),
 recorded_at timestamptz not null default now(),
 unique(session_id,seq)
);
create index replay_events_session_idx on replay_events(session_id,seq);
