# Skelet Deterministic Design Search (AF-04)

Status: implementation grain `skelet/af04-deterministic-search`, base `d1bb6437ccee7cb7a47a03ab65749316d30d9cc9`.
Scope: lexical search only. This document describes semantics, limitations, configuration, and operations.

## 1. What search is

Deterministic **lexical** search over the canonical asset registry (`icon`, `logo`, `font`).
It is not semantic understanding. There are no embeddings, no model inference, no paid
search/vector SaaS, and no GPU requirement on the search path.

Two execution modes, both deterministic:

- `postgres-fts`: PostgreSQL full-text search (`to_tsvector('simple', ...)` +
  `plainto_tsquery('simple', ...)`) for token relevance with `ts_rank`, OR'd with
  literal substring matching (titles, summaries, canonical text, collections, refs, tags).
- `literal-like`: parameterized `LIKE` substring matching only. Used when the query
  contains `%`, `_`, or `\` (punctuation must stay literal), or when the database
  reports a specific FTS capability failure (missing `to_tsvector` / `plainto_tsquery` /
  `ts_rank` / `tsvector` / `GIN`).

The response envelope carries `result.search_mode` so callers can observe which path ran.
REST (`GET /api/v1/assets`) and MCP (`search_assets`) expose the same mode, filters,
facets, cursor pagination, validation, and error taxonomy over `skelet.agent.v1`.

## 2. Corpus and ranking

Indexed expression (migration `012_asset_search_fts`):

```sql
to_tsvector('simple',
  coalesce(title, '') || ' ' ||
  coalesce(summary, '') || ' ' ||
  coalesce(canonical_text, '') || ' ' ||
  coalesce(metadata->>'collection', '') || ' ' ||
  coalesce(metadata->>'ref', ''))
```

The query uses the identical expression, so the `artifacts_search_fts_idx` GIN index
applies on PostgreSQL deployments that support it.

Ranking:

1. FTS matches (`ts_rank` descending) before literal-only matches (rank 0).
2. Deterministic tie-break: `title` ascending, then `id` ascending.
3. Literal path: `title` ascending, then `id` ascending.

Tags are searched by the literal path only; they are intentionally absent from the
FTS vector so tag-only matches rank after title matches deterministically.

Stable ordering is preserved across pages. Pagination uses the existing opaque
cursor contract (`encodeCursor` / `decodeCursor` over `{offset}`), default limit 20,
maximum 50.

## 3. Access control first

Authorization scope is part of the SQL predicate **before** ranking, pagination,
facet aggregation, or any cacheable result:

- Unscoped `searchAssets` serves the global corpus only (`workspace_id IS NULL`).
- Actor-scoped `searchAssetsForActor` additionally serves workspace rows the actor
  is authorized for (membership plus `workspace` / `public` visibility or
  `private` owner match), per AF-SEC-00.
- Facet counts aggregate the same scoped matched set; they never reveal rows the
  caller cannot access.

## 4. Filters and facets

Typed, validated filters:

- `kinds`: subset of `icon`, `logo`, `font`; non-empty, unique, maximum 3.
- `rights`: subset of `unknown`, `metadata_only`, `permitted`, `restricted`;
  non-empty, unique, maximum 4.
- `licenses`: SPDX strings or `unknown`; non-empty, unique, maximum 32, each 1..64 chars.
- `trademarkFree`: boolean. `true` matches `trademark = false`; `false` matches
  `trademark = true`; omitted means no trademark filter.
- `collection`: exact collection string, 1..200 chars after trim.
- `facets`: boolean. When `true`, the response includes access-scoped counts for
  `kinds`, `rights`, `licenses`, and `collections`, ordered by facet then value.

REST accepts `kinds`, `rights`, and `licenses` as comma-separated query values;
MCP accepts arrays. Both validate identically before reaching the registry.
Invalid filters fail `INVALID_INPUT` (REST 400, MCP -32602) with safe static messages.
No raw database errors leak to clients.

## 5. Validation and errors

- Query: trimmed string, 1..200 chars. Empty or overlong queries fail `INVALID_INPUT`.
- Limit: integer 1..50. Cursor: opaque base64url `{offset}`, offset 0..1,000,000.
- Duplicate or out-of-range filter values fail `INVALID_INPUT`.
- `LIKE` wildcards (`%`, `_`, `\`) are escaped and match literally; they never
  over-match the catalog.
- Registry validation failures are client input; persistence failures stay opaque
  (`INTERNAL_OPAQUE`) with no internals.
- Unknown and denied objects share `FORBIDDEN_OR_NOT_FOUND`; restricted rights
  answer `RIGHTS_RESTRICTED` after the actor gate passes. The frozen
  `skelet.agent.v1` envelope and error catalog are unchanged.

## 6. Limitations

- Lexical only: stemming uses the `simple` configuration (no English stemmer);
  queries are tokenized by `plainto_tsquery`, so operators (`&`, `|`, `!`, `:`)
  are treated as plain text, not query syntax.
- Substring semantics are preserved for punctuation queries via the literal path,
  which does not rank by relevance.
- Facets count exact matched rows; they are not relevance-weighted.
- Migration `012` creates the GIN index inside a `DO` block that skips only
  `undefined_function`, `feature_not_supported`, and `undefined_object`. Any other
  database error propagates and is never hidden behind the literal fallback.
- Rollback (`012_asset_search_fts.down.sql`) drops only `artifacts_search_fts_idx`.

## 7. Configuration and operations

- No configuration is required for the lexical path. No environment variable
  enables embeddings; any future embedding adapter must be explicit, opt-in,
  pinned, and CPU-budgeted, with deterministic fallback when disabled.
- Embedded test runtime is PGlite (`openDatabase`); production uses PostgreSQL
  via `DATABASE_URL`. Migration `012` applies on both; on runtimes without
  GIN/FTS support the index creation is skipped and the application fallback applies.
- Reproducible fixtures: `packages/assets/tests/fixtures/search-relevance.json`.
- Benchmark: `node scripts/bench_search.mjs [--records 200] [--iterations 100]`.
  On this Mac, 200 synthetic records measure warm p50 ~3.3 ms and p95 ~3.7 ms
  without facets (~5.3/5.9 ms with facets) on embedded PGlite. Production
  PostgreSQL timings must be measured on the deployment hardware before claiming
  SLOs; the planning target is p95 warm local metadata/FTS search under 500 ms
  on a fixed dataset.
- All user-provided values use parameterized SQL (`$1`, `$2`, ...). The FTS index
  and query expressions are constants, never interpolated user input.
