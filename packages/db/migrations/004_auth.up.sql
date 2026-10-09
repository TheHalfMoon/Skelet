-- G04-01: Skelet-owned authentication baseline (Better Auth-compatible shapes).
-- Users hold salted password verifiers; sessions hold SHA-256 hashes of
-- opaque tokens, never the tokens themselves. No workspace, billing,
-- collection, or public API surface is activated by this schema.
create table users (
 id uuid primary key default gen_random_uuid(),
 email text not null check(length(trim(email)) > 0 and length(email) <= 320),
 password_hash text not null check(length(password_hash) > 0),
 email_verified_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index users_email_unique on users(lower(email));

create table sessions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references users(id) on delete cascade,
 token_hash text not null unique check(length(token_hash) = 64),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions(user_id);

create function skelet_users_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
 new.updated_at = now();
 return new;
end;
$$;
create trigger users_updated_at before update on users
 for each row execute function skelet_users_updated_at();
