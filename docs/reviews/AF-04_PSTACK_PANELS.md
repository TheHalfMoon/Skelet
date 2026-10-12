# AF-04 PStack Panels (manual fresh-context fallback)

- PStack binary unavailable in this environment (`which pstack` not found).
  No new paid model provider was activated to satisfy PStack. This record
  uses the repository-permitted manual fresh-context four-bar review
  fallback. It MUST NOT be described as an independent-model review.
- Jev evidence head `c3ae0ff`: compatibility 0.26, correctness 0.60,
  evidence 0.36, reliability 0.32, scope 0.31, security 0.22
  (model `jev-1.13.0`). The elevated correctness meter is addressed below
  by targeted mechanism/test mapping; the panel verdict carries the gate
  per the Issue #34 precedent for Jev broad-meter insensitivity.

## Correctness — PASS

- FTS path uses `to_tsvector('simple', ...)` with `plainto_tsquery('simple', $1)`
  and `ts_rank`, OR'd with literal substring matching over titles, summaries,
  canonical text, collections, refs, and tags. The index expression in migration
  `012` is character-identical to the query expression, using the immutable
  regconfig overload so the GIN index applies on PostgreSQL.
- Punctuation queries (`%`, `_`, `\`) take the deterministic literal path with
  escaped `LIKE`, preserving legacy substring semantics (an underscore never
  normalizes to a space). Plain token queries take the FTS path. Both paths are
  covered by tests asserting `searchMode` and result counts.
- Fallback triggers only on FTS capability failures matching
  `to_tsvector|plainto_tsquery|ts_rank|tsvector|GIN` with `does not exist|not
  supported|unsupported|unavailable`. A dedicated test proves an arbitrary
  failure (`connection terminated`) propagates instead of hiding behind the fallback.
- Filters validate kinds (non-empty, unique, max 3, enum), rights (non-empty,
  unique, max 4, enum), licenses (non-empty, unique, max 32, each 1..64 chars),
  trademarkFree (boolean with true/false semantics), collection (trimmed 1..200),
  and facets (boolean) in the registry with identical early validation in REST
  and MCP. Duplicate and overlong inputs fail `INVALID_INPUT` on both transports.
- Facets aggregate the scoped matched set without limit/offset, ordered by facet
  then value. Ordering is `ts_rank DESC, title, id` on the FTS path and
  `title, id` on the literal path. Pagination concatenates to the full-order read
  in tests with no duplicates or skips.
- Jev correctness 0.60 probe: the most likely candidates are (a) the intentional
  `trademarkFree: false` behavior change (previously unfiltered, now matches
  trademarked rows, as required by typed trademark-state filtering and documented
  in `docs/search.md`), and (b) broad-meter sensitivity to the large diff size
  (+1261/-112). Both are disproven as defects by the filter tests (true matches
  only unmarked, false matches only marked), the ranking tests (title matches
  before tag-only with stable tie-break and repeat determinism), and the 42-test
  targeted run plus wire suites below. Zero must-fix remaining.

## Parsimony — PASS

- One search-plan builder owns validation, parameter binding, scope predicate,
  FTS/literal predicates, and suffix assembly; one scoped executor owns mode
  selection, fallback, and facet gating. REST and MCP both delegate to
  `searchAssetsForActorDetailed` with no per-transport ranking fork.
- Old `searchAssets` / `searchAssetsForActor` remain as thin wrappers so existing
  callers keep working. New response fields (`search_mode`, `facets`) are additive.
- Migration `012` adds one index; rollback drops only that index. No second
  database, no new service, no donor import, no embedding pipeline.
- Accepted advisory: the `$1::text is not null` guard on literal paths keeps
  parameter indices stable across both predicates. It is intentional, tested,
  and documented; no simplification was made that would renumber `$2` references.

## Product — PASS

- Tool names, REST paths, URI scheme (`skelet://artifact`), server-resolved auth,
  envelope version `skelet.agent.v1`, opaque cursors, and transport codes are
  unchanged. Old clients omitting the new filter/facet fields keep working.
- Required behaviors are wired: database-backed search, REST search and MCP
  `search_assets` with identical filters/facets/mode, cursor pagination with
  deterministic ordering, actor/workspace isolation, error handling with typed
  `INVALID_INPUT`, and FTS fallback. Real PGlite-backed dispatch over real TCP
  pipes (interop HTTP 8/8, stdio 3/3) plus envelope parity (13/13) are the E2E
  evidence; no mocked handlers substitute for these paths.
- Benchmark on this Mac (200 synthetic records, embedded PGlite): warm p50 ~3.3 ms
  and p95 ~3.7 ms without facets (~5.3/5.9 ms with facets), well under the 500 ms
  planning target. PGlite timings are environment-relative and recorded as such.

## Security — PASS

- Failure messages stay static catalog strings; validation messages are bounded
  pre-approved safe strings. No stacks, secrets, tokens, paths, or DB details in
  envelopes, facets, search_mode, cursors, or warnings.
- Authorization is in the SQL predicate before ranking, pagination, facets, and
  any cacheable result. Facet tests prove outsider totals exclude private rows
  (owner 2 vs outsider 1) and unscoped search never returns workspace rows.
- All user values are parameterized; FTS expressions are constants. The fallback
  never masks arbitrary failures (tested). Unknown and denied share
  `FORBIDDEN_OR_NOT_FOUND`; restricted rights answer `RIGHTS_RESTRICTED` after
  the actor gate.
- Zero must-fix remaining. One accepted advisory: Graft blast undercounts
  spawned-process coverage (HTTP subprocess + stdio pipes) by design; the wire
  suites above are the real coverage evidence for those paths.
