-- G03-02: canonical graph entities, source-linked and rights classified.
-- Preserve the foundational Source/Product/ProductVersion records.
create unique index product_versions_product_id_id_uq
  on product_versions (product_id, id);

create table artifacts (
  id uuid primary key,
  kind text not null check (kind in (
    'screen','page','section','component','icon','logo','font',
    'illustration','resource','brief','design')),
  product_id uuid references products(id) on delete restrict,
  product_version_id uuid,
  title text not null check (length(trim(title)) > 0),
  summary text,
  canonical_text text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  source_id uuid not null references sources(id) on delete restrict,
  source_record_id text,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  rights_classification text not null
    check (rights_classification in ('unknown','metadata_only','permitted','restricted')),
  visibility text not null default 'private'
    check (visibility in ('private','workspace','public')),
  constraint artifact_uuid_v7 check (substring(id::text,15,1) = '7'),
  constraint artifact_version_requires_product check (
    product_version_id is null or product_id is not null),
  constraint artifact_version_matches_product foreign key
    (product_id,product_version_id)
    references product_versions (product_id,id) on delete restrict,
  constraint artifact_public_rights check (
    visibility <> 'public' or rights_classification = 'permitted')
);
create index artifacts_source_idx on artifacts(source_id);
create index artifacts_product_version_idx on artifacts(product_version_id);
create index artifacts_kind_idx on artifacts(kind,created_at,id);
create index artifacts_content_hash_idx on artifacts(content_hash);

create table assets (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  media_type text not null check (length(trim(media_type)) > 0),
  byte_length bigint not null check (byte_length >= 0),
  width integer check (width > 0),
  height integer check (height > 0),
  duration_ms bigint check (duration_ms >= 0),
  storage_key text not null check (length(trim(storage_key)) > 0),
  source_url text,
  source_id uuid not null references sources(id) on delete restrict,
  rights_classification text not null
    check (rights_classification in ('unknown','metadata_only','permitted','restricted')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index assets_source_idx on assets(source_id);

create table patterns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(trim(title)) > 0),
  description text,
  source_id uuid not null references sources(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index patterns_source_idx on patterns(source_id);

-- Every graph edge resolves both endpoints, even when inserted through raw SQL.
create function skelet_graph_ref_exists(ref_kind text, ref_id uuid)
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

create table relations (
  id uuid primary key default gen_random_uuid(),
  from_type text not null check (from_type in (
    'source','product','product_version','artifact','asset','pattern')),
  from_id uuid not null,
  relation_type text not null check (relation_type in (
    'contains','belongs_to','uses','derived_from','visually_similar_to',
    'semantically_similar_to','appears_in','follows','precedes',
    'variant_of','extracted_from','references')),
  to_type text not null check (to_type in (
    'source','product','product_version','artifact','asset','pattern')),
  to_id uuid not null,
  confidence double precision check (confidence between 0 and 1),
  evidence jsonb check (evidence is null or jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now(),
  constraint relation_no_self_edge check (
    from_type <> to_type or from_id <> to_id),
  unique(from_type,from_id,relation_type,to_type,to_id)
);
create index relations_from_idx on relations(from_type,from_id);
create index relations_to_idx on relations(to_type,to_id);

create function skelet_validate_relation() returns trigger
language plpgsql as $$
begin
  if not skelet_graph_ref_exists(new.from_type,new.from_id) then
    raise exception 'graph relation source endpoint not found';
  end if;
  if not skelet_graph_ref_exists(new.to_type,new.to_id) then
    raise exception 'graph relation target endpoint not found';
  end if;
  return new;
end;
$$;
create trigger relations_validate_endpoints
  before insert or update of from_type,from_id,to_type,to_id on relations
  for each row execute function skelet_validate_relation();

-- Polymorphic graph edges cannot be protected by a single foreign key.
-- Refuse deletion of an endpoint until its edges are explicitly removed.
create function skelet_guard_graph_endpoint_delete() returns trigger
language plpgsql as $$
begin
  if exists (
    select 1 from relations
    where (from_type=TG_ARGV[0] and from_id=old.id)
       or (to_type=TG_ARGV[0] and to_id=old.id)
  ) then
    raise exception 'graph endpoint still referenced';
  end if;
  return old;
end;
$$;
create trigger skelet_source_graph_guard before delete on sources
  for each row execute function skelet_guard_graph_endpoint_delete('source');
create trigger skelet_product_graph_guard before delete on products
  for each row execute function skelet_guard_graph_endpoint_delete('product');
create trigger skelet_version_graph_guard before delete on product_versions
  for each row execute function skelet_guard_graph_endpoint_delete('product_version');
create trigger skelet_artifact_graph_guard before delete on artifacts
  for each row execute function skelet_guard_graph_endpoint_delete('artifact');
create trigger skelet_asset_graph_guard before delete on assets
  for each row execute function skelet_guard_graph_endpoint_delete('asset');
create trigger skelet_pattern_graph_guard before delete on patterns
  for each row execute function skelet_guard_graph_endpoint_delete('pattern');
