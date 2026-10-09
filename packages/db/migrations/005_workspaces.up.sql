-- G04-02: workspace authority and member roles (owner/admin/member).
-- No billing, collection API, or public endpoint is activated by this schema.
create table workspaces (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) > 0 and length(name) <= 200),
 created_by uuid references users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table workspace_members (
 workspace_id uuid not null references workspaces(id) on delete cascade,
 user_id uuid not null references users(id) on delete cascade,
 role text not null check(role in ('owner', 'admin', 'member')),
 joined_at timestamptz not null default now(),
 primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on workspace_members(user_id);

create function skelet_workspaces_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
 new.updated_at = now();
 return new;
end;
$$;
create trigger workspaces_updated_at before update on workspaces
 for each row execute function skelet_workspaces_updated_at();
