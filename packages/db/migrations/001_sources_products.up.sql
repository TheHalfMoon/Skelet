-- 001: canonical Source, Product, ProductVersion tables.
-- UP migration. Ledger entry: 001_sources_products.

create table sources (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  kind text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources (id) on delete cascade,
  external_id text,
  title text not null,
  created_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create table product_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  version_no integer not null,
  captured_at timestamptz not null default now(),
  unique (product_id, version_no)
);

create index products_source_id_idx on products (source_id);
create index product_versions_product_id_idx on product_versions (product_id);
