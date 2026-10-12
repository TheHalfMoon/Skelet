# AF-04 Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: AF-04, branch `skelet/af04-deterministic-search`, base
  `d1bb6437ccee7cb7a47a03ab65749316d30d9cc9`, implementation head
  `c3ae0ff47548e9d329644d6dc4cfb53106932269`.
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM
  provider credential is configured in this environment, so the official
  `ocr delegate` workflow was used per `GOVERNANCE.md`.
- `ocr delegate preview --from <base> --to HEAD` on `c3ae0ff`: 9 reviewable /
  11 total. Excluded by OCR itself: `docs/search.md` (`unsupported_ext`;
  prose documentation reviewed manually below) +
  `packages/assets/tests/fixtures/search-relevance.json` (`default_path`;
  fixture data validated by the search test suite below). No files excluded by hand.
- Reviewable: `apps/web/lib/mcp.ts` (modified, +76/-7),
  `apps/web/lib/rest.ts` (modified, +84/-8),
  `apps/web/tests/search.test.mjs` (added, +131/-0),
  `packages/assets/src/registry.ts` (modified, +253/-97),
  `packages/assets/tests/assets.test.mjs` (modified, +34/-0),
  `packages/assets/tests/search.test.mjs` (added, +327/-0),
  `packages/db/migrations/012_asset_search_fts.up.sql` (added, +26/-0),
  `packages/db/migrations/012_asset_search_fts.down.sql` (added, +2/-0),
  `scripts/bench_search.mjs` (added, +102/-0).
- Delegated review executed against the exact diff:
  - Group 1 (TS/JS/MJS): zero `var`, zero loose equality (only `===`/`!==`
    and `??`), zero `any` type in product code (one comment occurrence of the
    English word "any", not a type), zero nested ternaries, zero `eval` /
    `Function` / `innerHTML` / `document.write`, zero native prototype
    mutation, zero hardcoded business URLs beyond the canonical `skelet://`
    URI scheme, zero secrets or credentials in output (bearer-token plumbing
    is server-resolved session handling, not embedded credentials), zero
    `console.log`, zero `TODO` / `FIXME`. Async paths use `async`/`await`
    with `try`/`catch` mapping to the canonical catalog; facet aggregation
    is a single scoped query, not parallelizable without changing denial
    semantics. Null checks via `typeof`, `Array.isArray`, and explicit
    `undefined` guards before destructuring. No finding.
  - Group 2 (SQL migrations): all user-provided values use parameterized
    `$1`, `$2`, ... placeholders; the FTS index and query expressions are
    constants, never interpolated user input. `LIKE` wildcards are escaped
    and match literally. Scope filter is part of the SQL predicate before
    ranking, pagination, and facets. Migration `012` creates only
    `artifacts_search_fts_idx` inside a `DO` block that skips only
    `undefined_function`, `feature_not_supported`, and `undefined_object`;
    any other database error propagates. Rollback drops only that index.
    No finding.
  - Docs (`docs/search.md`, manually reviewed): describes lexical-only
    semantics, both search modes, corpus, ranking, access-first scope,
    filters, facets, validation, errors, limitations, configuration, and
    operations with no claim of semantic understanding and no embedded
    credentials. No finding.
  - Fixture (`search-relevance.json`, manually reviewed): frozen synthetic
    records and cases with no secrets, matching the registry test suite. No finding.
- Findings: zero unresolved blocking findings. This record MUST NOT be
  described as an LLM-backed OCR scan.
- Recount on evidence head `6e904fc0f7f5e4b89f9b64e83070c4963433ab18`:
  `ocr delegate preview` reports 11 reviewable / 15 total. The 4 excluded
  by OCR itself are this record + `AF-04_PSTACK_PANELS.md` +
  `docs/search.md` (markdown `unsupported_ext`) +
  `packages/assets/tests/fixtures/search-relevance.json` (`default_path`;
  fixture data covered by the search test suite above). The 2 added
  reviewable files are the Jev JSON pair (same key-spelling rule group, no
  finding). Jev was rerun on the evidence head with zero blocking findings.
- Recount on fix head `c48c887eea306a24793a68327db9d0210c9851d3`
  (migration-ledger test maintenance): `ocr delegate preview` reports
  24 reviewable / 28 total. New reviewables are the 13 `packages/db/tests`
  ledger assertions (single-token `"012_asset_search_fts"` additions, same
  key-spelling rule group, no finding) plus the 2 Jev JSON files. Markdown
  and fixture exclusions unchanged. Jev rerun on the fix head holds zero
  blocking findings.
