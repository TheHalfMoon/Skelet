# AF-13b Coverage Analysis — `resolve_asset` and `analyze_image` Disposition

Branch: `skelet/af13b-coverage`. Base: `e94611b` (PR #103 merge).
Scope: verification record only. No product code changed. This grain does
not close P08 by prose; it records measured re-verification plus the
domain-grounded reason two literal tool names need no separate verbs.

## 1. `resolve_asset`: covered by `get_asset` + `get_object`

Requirement intent (P08): agents can resolve references to canonical
records with deny-preserving errors.

Domain fact: artifacts carry no read-time external identifier. The schema
(`packages/db/migrations/001_sources_products.up.sql`,
`003_workflows.up.sql`) scopes `external_id` to sources, products, and
import ledgers; import-time `artifactExternalId` values (flow steps) are
resolved during `importCorpusFixture` and never persisted as artifact
identifiers. The only stable read-time identity is the UUID; the only
stable locator is the `skelet://` URI.

Coverage, re-verified on this branch (real execution, 2026-10-14):

- `get_asset` (UUID → record + serving policy) via
  `resolveAssetForActor`: `apps/web/tests/mcp.test.mjs` 11/11 PASS
  (includes stable-URI assertions and malformed-ID fail-closed),
  `apps/web/tests/rest.test.mjs` 5/5 PASS (asset endpoint resolves or
  404s).
- `get_object` (URI → object for `skelet://artifact/{id}` and
  `skelet://collection/{id}`): envelope-parity 14/14 PASS (includes
  cross-workspace denial with no oracle and rights-restricted paths).
- A separate `resolve_asset` verb would duplicate `get_asset` (gratuitous
  rename, explicitly out of bounds) or resolve import-time external IDs
  that do not exist at read time (incorrect). No separate verb is built.

## 2. `analyze_image` (and `analyze_url`): job path qualified, single-shot deferred

Requirement intent (P08/P09): agents can analyze images through a typed,
provenance-bound path.

Coverage, re-verified on this branch:

- The qualified route is the durable Lens job surface (`lens_create_job`
  and siblings, 7 tools): P09 VERIFIED, lens 197/197 including real
  Chromium in the final qualification record.
- Single-shot verbs stay explicitly deferred: `skills/skelet-lens/SKILL.md`
  gates them ("do not invoke or promise them — drive the qualified job
  tools"), enforced by `scripts/validate_skills.py` (`UPCOMING_TOOLS`
  still lists `analyze_url`, `analyze_image`, `get_changes`):
  SKILLS_VALIDATION_PASSED.
- Building synchronous single-shot analysis would bypass the budgeted,
  isolated, re-authenticated job pipeline the security matrix qualifies.
  No single-shot verb is built in this grain.

## Remaining P08 gaps (still open, not claimed)

- `get_changes` (P13, AF-15a when started), MCP Apps views (P12),
  AF-14c compaction pack. Unchanged by this grain.
