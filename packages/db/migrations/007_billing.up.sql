-- G04-04: plan entitlements and idempotent billing-event intake.
-- Prices and provider credentials stay configuration; no charge is
-- executed by this schema. No public API is activated here.
create table subscriptions (
 workspace_id uuid primary key references workspaces(id) on delete cascade,
 plan_key text not null check(plan_key in ('free', 'pro', 'team')),
 status text not null default 'active'
  check(status in ('active', 'past_due', 'canceled', 'incomplete')),
 seats integer not null default 1 check(seats >= 1),
 stripe_customer_id text,
 stripe_subscription_id text,
 current_period_end timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table billing_events (
 id uuid primary key default gen_random_uuid(),
 provider text not null default 'stripe' check(provider in ('stripe')),
 event_id text not null unique
  check(length(trim(event_id)) > 0 and char_length(event_id) <= 256),
 event_type text not null check(length(trim(event_type)) > 0),
 payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload) = 'object'),
 received_at timestamptz not null default now(),
 applied_at timestamptz
);
create index billing_events_type_idx on billing_events(event_type);

create function skelet_subscriptions_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
 new.updated_at = now();
 return new;
end;
$$;
create trigger subscriptions_updated_at before update on subscriptions
 for each row execute function skelet_subscriptions_updated_at();
