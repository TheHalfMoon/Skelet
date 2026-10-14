# AF-12 Acceptance Matrix — P00–P15 / R0–R7

Status: DRAFT AUDIT RECORD on `skelet/af12-matrix-audit`. Base: `543641a` (PR #91 merge, CI `38502030267` SUCCESS 15/15).
Method: each row cites live implementation, committed tests, reproducible commands, and evidence. No invented evidence. A passing unit test alone does not verify an integrated feature. Missing functionality is never NOT APPLICABLE without an authoritative reason.

Frontier revalidated 2026-10-14:
- HEAD `543641a`, origin/main identical, branch `skelet/af12-matrix-audit` clean except untracked `.ignore`.
- Issues: #34 OPEN (execution tracker), #62 OPEN (ArtCraft), #9 CLOSED (Build Kit).
- PRs #1–#91 all MERGED, zero open PRs at time of writing.
- CI jobs (15): bootstrap, graft, no-model, web, worker, monet-screenshot-queue, providers, editor-adapters, ingest, assets, sdk, lens, db-foundation, storage-ubuntu-24.04, storage-windows-latest.

Requirement sources:
- `docs/IMPLEMENTATION_PLAN.md` sections 14 (P00–P15), 8.1/15 (P09b), 21 (security matrix), 13 (CI gates).
- `docs/architecture/AGENT_FIRST_ZERO_FOUNDER_COST_BLUEPRINT_2026-10-11.md` section 10 for R0–R7 readiness dimensions and AF-00–AF-12 grain mapping (canonical after PR #63).
- `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md`, `GOVERNANCE.md`, `docs/operations/PLAN_GAP_REGISTER_2026-10-08.md`.
- `docs/qualification/ISSUE_9_MATRIX.md` for P09b closeout scope.
- Issue #62 for ArtCraft AC-00–AC-04 and global gates.

R-gate definitions (authoritative per AF-00 blueprint section 10):
- R0 provenance — immutable source pins, code/data/asset/model/trademark separation, per-item rights.
- R1 runnable shell — clean install, lint/typecheck/build, health/smoke from one checkout.
- R2 tenant/domain/storage — workspace auth, actor-scoped reads, content-addressed storage, idempotent domain.
- R3 S0 end-to-end — rights-cleared fixture to search to inspect to save to pack to second-client recovery, no model.
- R4 guarded Lens — fail-closed URL intake, isolated capture, deterministic report, no mandatory LLM.
- R5 qualified corpus/search and agent interoperability — corpus usable offline, lexical baseline measured, versioned agent contract with 3 clients.
- R6 local/paid beta security plus operations — quotas, rate limits, billing lifecycle, backup/restore, takedown purge, abuse controls.
- R7 release correctness — signed release artifacts, SBOM/scans, migration rehearsal, SLOs/alerts, load proof, docs.

Column key per row: (1) ID, (2) acceptance criterion (abridged with source section), (3) implementation reference, (4) test reference, (5) verification command, (6) evidence commit/CI, (7) security/rights, (8) status, (9) remaining gap, (10) next action.

---

## P00 — Governance and Upstream Lock (plan section 14)

1. ID: P00.
2. Acceptance: PRODUCT/ARCHITECTURE/SECURITY/GOVERNANCE canonical; UPSTREAMS.lock.yml schema with role/permission/license placeholders and execution-time pin rule; CODE/DATA_PROVENANCE; CI skeleton and branch governance; no runtime donor code imported yet.
3. Implementation: `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md`, `GOVERNANCE.md`, `CODE_PROVENANCE.md`, `DATA_PROVENANCE.md`, `schemas/upstreams.schema.json`, `UPSTREAMS.lock.yml`, `docs/operations/CI.md`, `.github/workflows/ci.yml`.
4. Tests: `tests/test_validate_upstreams.py`, `tests/test_ci_hygiene.py`, `scripts/validate_upstreams.py`, `scripts/ci_hygiene.py`.
5. Verify: `python -m unittest discover -s tests -v`; `python scripts/validate_upstreams.py`; `python scripts/ci_hygiene.py --expected-head $(git rev-parse HEAD)`.
6. Evidence: PRs #1 (G00-01), #2 (G00-02), #3 (G00-03), #8 (G00-04), #10 (G00-05); post-merge main CI SUCCESS chain; HEAD `543641a` CI `38502030267` SUCCESS 15/15.
7. Security/rights: pins are immutable commits, not branch names; code vs data/asset/model/trademark scopes separated in lock; CI hygiene rejects secrets/binary corpus abuse.
8. Status: VERIFIED.
9. Gap: none for P00 scope.
10. Next: none; preserve as canonical.

## P01 — Monet Selective Baseline Import (plan section 14)

1. ID: P01.
2. Acceptance: live Monet pin verified; import manifest before copying; only required source/config/scripts/tests; bulk media/branding/deployment/secrets excluded; notices preserved; Skelet identity without blind third-party rewrite; install/lint/typecheck/tests/build qualified.
3. Implementation: `imports/monet-registry/`, `scripts/audit_monet_code.py`, `docs/provenance/MONET_*.md`, `apps/web` Skelet-owned shell, `packages/*` workspace layout, `UPSTREAMS.lock.yml` id `monet-registry` pin `85c966f8d94572431bcbb4439f9fd7ea2a893321`.
4. Tests: `tests/test_monet_import_manifest.py`, `tests/test_audit_monet_code.py`, `tests/test_monet_dependency_closure.py`, `tests/test_monet_queue_import.py`, web/worker lint/typecheck/build/smoke.
5. Verify: `python -m unittest discover -s tests`; `pnpm install --frozen-lockfile`; `pnpm --dir apps/web lint && pnpm --dir apps/web typecheck && pnpm --dir apps/web build`; `node scripts/smoke-web.mjs 3103`.
6. Evidence: PRs #4 (G01-01), #5 (G01-01a), #6 (G01-02a), #7 (G01-02b), #11 (G01-02c), #12 (G01-03a), #13 (G01-03b); plan hardening section 23 records non-runnable-Monet correction and Skelet-owned shell decision; HEAD CI SUCCESS.
7. Security/rights: quarantine decisions recorded; dependency closure reviewed; no donor secrets/branding activated; license inventory in provenance docs.
8. Status: VERIFIED (under hardened interpretation: Skelet-owned shell plus one dependency-closed qualified capability, not full Monet product parity).
9. Gap: none blocking; donor parity beyond qualified modules is explicitly out of scope.
10. Next: none for P01.

## P02 — Repository Reshape and Local Dev Stack (plan section 14)

1. ID: P02.
2. Acceptance: pnpm workspace layout; apps/web and apps/worker; packages/domain/db/storage/provenance/providers/testkit (as implemented); local PostgreSQL dev config and filesystem storage adapter; environment schema/validation; no intended behavior change; web and worker run independently; clean reset/bootstrap documented and tested.
3. Implementation: `pnpm-workspace.yaml`, `apps/web/`, `apps/worker/`, `packages/db`, `packages/storage`, `packages/providers`, `packages/ingest`, `apps/worker` env/health contract.
4. Tests: `apps/worker/tests/env.test.mjs`, `apps/worker/tests/cli.test.mjs`, `apps/web/tests/health-route.test.mjs`, `packages/storage/tests/storage.test.mjs`, `packages/db/tests/db-foundation.test.mjs`.
5. Verify: `pnpm install --frozen-lockfile`; `pnpm --dir apps/web build`; `pnpm --dir apps/worker start health`; `node --experimental-strip-types --test apps/worker/tests/*.test.mjs`.
6. Evidence: PR #14 (G02-02 worker shell and env contract) plus reshape history via G02-01 move; HEAD CI `web`, `worker`, `storage`, `db-foundation` jobs SUCCESS.
7. Security/rights: env schema rejects unknown secrets; worker health proves no business jobs yet at that grain; storage stays local-first.
8. Status: VERIFIED.
9. Gap: none.
10. Next: none.

## P03 — Canonical Domain plus Persistence (plan section 14)

1. ID: P03.
2. Acceptance: migrations for Source/Product/ProductVersion/Artifact/Asset/Relation/Flow/FlowStep/Pattern/Collection/CaptureRun/AnalysisRun/ImportRecord; content-addressed asset service; repository/service layer; source/external-ID idempotency; deterministic fixtures; CRUD/relation traversal pass; duplicate import is no-op; provenance mandatory for published imports.
3. Implementation: `packages/db/src/db.ts`, `migrate.ts`, `graph.ts`, `repositories.ts`, `workflows.ts`, `jobs.ts`, `idempotency.ts`, `artifact-access.ts`, `packages/storage/src/*` SHA-256 dedupe.
4. Tests: `packages/db/tests/db-foundation.test.mjs`, `graph.test.mjs`, `workflows.test.mjs`, `artifact-access.test.mjs`, `packages/storage/tests/storage.test.mjs`, `packages/ingest/tests/publish.test.mjs`, PG suites `pg-integration/pg-graph/pg-workflows/pg-build-kit` (14 tests on real PostgreSQL).
5. Verify: `node --experimental-strip-types --test packages/db/tests/db-foundation.test.mjs packages/db/tests/graph.test.mjs packages/db/tests/workflows.test.mjs packages/db/tests/artifact-access.test.mjs`; `node --experimental-strip-types --test packages/storage/tests/storage.test.mjs`; real PG with `SKELET_TEST_DATABASE_URL=postgresql://skelet_test:local_ci_fixture_only@127.0.0.1:5432/skelet_test SKELET_DB_TEST_CONFIRM=yes node --experimental-strip-types --test packages/db/tests/pg-*.test.mjs`.
6. Evidence: PRs #16 (G03-01), #18 (G03-02), #20 (G03-03), #22 (G03-04); AF-12 qualification records DB non-PG 99/99, PG 14/14, storage 11/11; HEAD CI `db-foundation` SUCCESS.
7. Security/rights: FK constraints, content hashes, idempotency keys, actor-scoped access gate (see AF-SEC-00); no public asset serving without policy.
8. Status: VERIFIED.
9. Gap: none for P03 tables; typed extension tables remain future-only per plan and are not required.
10. Next: none.

## P04 — Auth, Workspaces, Billing Skeleton (plan section 14)

1. ID: P04.
2. Acceptance: auth integration; workspace/organization roles; collections and saved references; Stripe plugin behind feature/config gate; Free/Pro/Team capability model without hard-coded prices; signup/signin, workspace create/join, collection save; cross-workspace isolation; webhooks signature-verified and replay-safe.
3. Implementation: `packages/db/src/auth.ts`, `workspaces.ts`, `collections.ts`, `billing.ts`, `apps/web/lib/boards.ts`, `apps/web/app/api/v1/boards/*`, collection save-reference path.
4. Tests: `packages/db/tests/auth.test.mjs`, `workspaces.test.mjs`, `collections.test.mjs`, `billing.test.mjs`, `apps/web/tests/boards.test.mjs`, `mcp-boards.test.mjs`, `boards-ui.test.mjs`.
5. Verify: `node --experimental-strip-types --test packages/db/tests/auth.test.mjs packages/db/tests/workspaces.test.mjs packages/db/tests/collections.test.mjs packages/db/tests/billing.test.mjs`; `node --experimental-strip-types --test apps/web/tests/boards.test.mjs`.
6. Evidence: PRs #23 (G04-01), #24 (G04-02), #25 (G04-03), #26 (G04-04); AF-SEC-00 (PR #66) centralizes actor checks; HEAD CI `db-foundation`/`web` SUCCESS.
7. Security/rights: server-side membership/role checks; forged IDs denied; expired sessions fail closed; billing state never trusts client plan fields; plan prices remain configuration.
8. Status: VERIFIED (skeleton scope; production price catalog and hosted billing operations are P15, not P04).
9. Gap: production webhook live-money proof and plan enforcement at commercial scale remain P15.
10. Next: cover commercial billing enforcement in P15 grain; no P04 reopen.

## P05 — Ingestion Framework plus Jobs (plan section 14)

1. ID: P05.
2. Acceptance: provider interface/registry; PostgreSQL-backed queue; CaptureRun/AnalysisRun lifecycle and retries; dry-run, dead-letter, cancellation, concurrency limits; object-store upload/dedupe; fixture source end-to-end through queue to graph to store to publish; re-import idempotent; failed enrichment never partially publishes.
3. Implementation: `packages/db/src/jobs.ts`, `packages/db/src/build-kit.ts`, `packages/providers/src/*`, `packages/ingest/src/*`, `packages/lens/src/capture-worker.ts`, `capture-scope.ts`, `capture-traversal.ts`.
4. Tests: `packages/db/tests/jobs.test.mjs`, `build-kit.test.mjs`, `packages/providers/tests/provider.test.mjs`, `packages/ingest/tests/publish.test.mjs`, `packages/lens/tests/capture-scope.test.mjs`, `capture-traversal.test.mjs`, `kit-fixture-chain.test.mjs`.
5. Verify: `node --experimental-strip-types --test packages/db/tests/jobs.test.mjs packages/db/tests/build-kit.test.mjs packages/providers/tests/provider.test.mjs packages/ingest/tests/publish.test.mjs`.
6. Evidence: PRs #27 (G05-01), #28 (G05-02), #29 (G05-03); AF-05a–g chain (PRs #73–#79) exercises queue lifecycle with cancel/retry/resume/expiry/quota; HEAD CI `providers`, `ingest`, `lens`, `db-foundation` SUCCESS.
7. Security/rights: timeout/cancel/health/provenance/egress-cost on every provider; isolated capture worker has no prod secrets; publish is terminal only after validators.
8. Status: VERIFIED.
9. Gap: none for framework; individual corpus adapters are P06/P10 scope.
10. Next: none.

## P06 — Assets v1 (plan section 14)

1. ID: P06.
2. Acceptance: Iconify-compatible importer/search; Simple Icons/SVGL-authorized logo ingestion; Fontsource metadata ingestion; OpenBrand adapter; unified Assets UI/API; rights/license/trademark filters; one query returns icons/logos/fonts on shared contract; every downloadable has provenance and serving policy; MCP/API resolves SVG/font metadata without web scraping.
3. Implementation: `packages/assets/src/*` (`registry.ts`, iconset, brandfont), `packages/providers` OpenBrand path, `apps/web/app/api/v1/assets/*`, `apps/web/lib/mcp.ts` `search_assets`/`get_asset`, `skills/skelet-assets/SKILL.md`.
4. Tests: `packages/assets/tests/assets.test.mjs`, `iconset.test.mjs`, `brandfont.test.mjs`, `search.test.mjs`, `apps/web/tests/search.test.mjs`, rights-denial cases in `kit-fixture-chain`, `export-surface`, AF-03b parity.
5. Verify: `node --experimental-strip-types --test packages/assets/tests/assets.test.mjs packages/assets/tests/iconset.test.mjs packages/assets/tests/brandfont.test.mjs`; `python scripts/validate_registry.py`; `python scripts/validate_skills.py`.
6. Evidence: PRs #30 (G06-01), #31 (G06-02), #32 (G06-03); AF-12 record assets 13/13; HEAD CI `assets` SUCCESS.
7. Security/rights: per-item serving matrix; trademark state explicit; disallowed bytes withheld; metadata-only/link-only enforced; notices preserved.
8. Status: VERIFIED (within no-model/local scope; hosted font-file redistribution remains rights-gated by design).
9. Gap: none blocking; broader logo/font corpus expansion is data work, not a missing framework.
10. Next: none.

## P07 — Component Registry (plan section 14)

1. ID: P07.
2. Acceptance: shadcn-compatible endpoint and index; Monet/OpenSourceUI/PaceUI adapters for permitted components only; dependency/provenance metadata and live preview; contract tests; shadcn MCP discovers items without Skelet plugin; clean sample app installs a qualified component and builds.
3. Implementation: `apps/web/app/api/registry/route.ts`, `apps/web/app/api/registry/[name]/route.ts`, `packages/assets/src/registry.ts`, `scripts/validate_registry.py`, `scripts/prove_registry_install.mjs`.
4. Tests: `apps/web/tests/registry.test.mjs`, `scripts/validate_registry.py` (2 items), `scripts/prove_registry_install.mjs` (`skelet-button`, `skelet-card`), AF-05 R1 consumer smoke `scripts/prove_starter_consumer.mjs`.
5. Verify: `python scripts/validate_registry.py`; `node scripts/prove_registry_install.mjs`; `node --experimental-strip-types --test apps/web/tests/registry.test.mjs`.
6. Evidence: PRs #33 (G07-01), #35 (G07-02); AF-05-closeout (PR #80) plus AF-05-R1 (PR #81) close R1; HEAD CI `web` SUCCESS (registry validation plus install proof run in `web` job).
7. Security/rights: only permitted components normalized; dependencies and provenance required; generated registry validated in CI.
8. Status: VERIFIED.
9. Gap: none for launch contract; additional component corpus is data expansion.
10. Next: none.

## P08 — Agent Platform v1 (plan sections 9/14)

1. ID: P08.
2. Acceptance (literal plan): Remote MCP Streamable HTTP; stable `skelet://` URIs; launch tools search_design/get_object/find_similar/compare_design/analyze_url/analyze_image/resolve_asset/save_reference/create_reference_pack/get_changes/search_registry; skills for research/assets/lens/reference-pack; REST v1 parity; 3 independent MCP clients; agent search-inspect-save-pack end-to-end; schema snapshots.
3. Implementation: `apps/web/app/api/mcp/route.ts`, `apps/web/lib/mcp.ts` (actual tools: `search_assets`, `get_asset`, `get_registry_item`, `save_reference`, `create_reference_pack`, `get_object`, 7 `lens_*`, 3 `board_*`), `apps/web/lib/agent-contract.ts`, `apps/web/lib/rest.ts`, `apps/web/app/api/v1/objects/route.ts`, `packages/sdk-ts`, `scripts/skelet_sdk.py`, `scripts/skelet.py`, `scripts/mcp_stdio.mjs`, `skills/skelet-research`, `skelet-assets`, `skelet-lens`, `skelet-reference-pack`, `schemas/agent-contract.schema.json`.
4. Tests: `apps/web/tests/mcp.test.mjs`, `envelope-parity.test.mjs`, `interop-http.test.mjs`, `interop-stdio.test.mjs`, `rest.test.mjs`, `search.test.mjs`, `mcp-lens.test.mjs`, `mcp-boards.test.mjs`, `packages/sdk-ts/tests/client.test.mjs`, `tests/test_validate_agent_contract.py`, `tests/test_validate_skills.py`, `tests/test_mcp_interop_py.py`, `tests/test_skelet_sdk.py`.
5. Verify: `node --experimental-strip-types --test tests/node/*.test.mjs apps/web/tests/*.test.mjs` (web job subset); `python scripts/validate_agent_contract.py`; `python scripts/validate_skills.py`; `node --experimental-strip-types --test packages/sdk-ts/tests/client.test.mjs`; `python -m unittest discover -s tests`.
6. Evidence: PRs #36 (G08-01), #37 (G08-02), #38 (G08-03), #39 (G08-04), #40 (G08-05), #41 (G08-06); AF-03a (PR #69), AF-03b (PR #70), AF-03c (PR #71, three wire clients: Node fetch HTTP, Python urllib HTTP, Node stdio pipes, plus TS/Python SDK envelope tests and migration 011 ledger); AF-SEC-00 (PR #66) actor scoping; HEAD CI `web`, `sdk`, `bootstrap` SUCCESS.
7. Security/rights: bearer-gated asset tools; session-bound write identities; workspace denial parity; revoked/expired denial; rate/quota; secret redaction; error taxonomy without stack/secret leak (`FORBIDDEN_OR_NOT_FOUND` opaque).
8. Status: PARTIAL.
9. Gap: canonical tool-name/behavior gaps versus literal plan: no first-class `search_design` (implemented as `search_assets`), no `find_similar`, no `compare_design`, no single-shot `analyze_url`/`analyze_image` (implemented as durable `lens_*` jobs; skill explicitly says single-shot lands later), no `resolve_asset` distinct from `get_asset`/`get_object`, no `search_registry` MCP tool (only `get_registry_item` plus REST registry), no `get_changes` (P13 unimplemented), no `list_flows`/`get_flow_steps` MCP surface despite DB flow tables, no MCP Apps SDK views as MCP surfaces. Interop is evidenced for implemented tools, not for missing tools.
10. Next: smallest coherent grain AF-13a: add `find_similar` deterministic fingerprint/metadata mode plus `compare_design` evidence-linked diff over qualified corpus with rights gating, contract fixtures, and 3-client parity; then AF-13b: `resolve_asset`/`search_registry`/`analyze_image`/`get_changes` only when underlying services qualify. Do not rename working tools gratuitously; add versioned tools with compatibility snapshots.

## P09 — Lens v1 (plan sections 8/14)

1. ID: P09.
2. Acceptance: safe URL intake/SSRF controls; isolated Playwright capture worker; Dembrandt/OpenBrand/OpenTechAlyzer adapters; optional Squirrelscan; Design DNA projection and exports; public URL to reproducible report with screenshot/DOM/sections/colors/type/spacing/logos/assets/tech/provenance/agent export; hostile/private URLs fail closed; no external LLM on qualified path.
3. Implementation: `packages/lens/src/url-guard.ts`, `capture-network.ts`, `capture-child.ts`, `capture-worker.ts`, `design-tokens.ts`, `style-evidence.ts`, `tech-signal-evidence.ts`, `tech-clue-matcher.ts`, `report-assembly.ts`, `export-surface.ts`, `analyze-url.ts`, `apps/web/app/api/v1/lens/jobs/*`, `apps/web/app/lens/page.tsx`, `UPSTREAMS.lock.yml` Dembrandt/OpenBrand/OpenTechAlyzer/Squirrelscan pins with `docs/provenance/*EVALUATION*`.
4. Tests: `url-guard.test.mjs`, `capture-network.test.mjs`, `capture-browser.test.mjs` (real Chromium), `design-tokens.test.mjs`, `style-evidence.test.mjs`, `tech-signal-evidence.test.mjs`, `tech-clue-matcher.test.mjs`, `analyze-url.test.mjs`, `report-assembly.test.mjs`, `export-surface.test.mjs`, `lens-jobs.test.mjs`, `lens-recovery.test.mjs`, `lens-ui.test.mjs`, `mcp-lens.test.mjs`, `no-paid-path.test.mjs`.
5. Verify: `node --experimental-strip-types --test packages/lens/tests/url-guard.test.mjs packages/lens/tests/design-tokens.test.mjs packages/lens/tests/capture-network.test.mjs packages/lens/tests/capture-browser.test.mjs packages/lens/tests/report-assembly.test.mjs packages/lens/tests/style-evidence.test.mjs packages/lens/tests/export-surface.test.mjs packages/lens/tests/tech-signal-evidence.test.mjs packages/lens/tests/tech-clue-matcher.test.mjs packages/lens/tests/analyze-url.test.mjs`; lens job `prove_starter_consumer` runs in CI lens job.
6. Evidence: PRs #42–#56 (G09-01–G09-13); AF-05e (PR #77) REST/MCP/UI parity; AF-05g-i (PR #79) no-paid-path guard; `docs/qualification/NO_MODEL_BUILD_KIT.md`; AF-12 record lens 197/197 including real Chromium; HEAD CI `lens` SUCCESS.
7. Security/rights: SSRF/DNS/redirect/rebinding/scheme/size/loop/timeout/SVG-isolation/secret-free-worker matrix; prompt-injection hostile content stays data; per-item rights withheld from exports.
8. Status: VERIFIED (qualified deterministic path; donor adapters explicitly evaluation-first, not runtime-imported, per ISSUE_9_MATRIX criterion 7).
9. Gap: single-shot `analyze_url`/`analyze_image` MCP verbs remain job-based by design; no gap versus qualified Lens report contract.
10. Next: none for P09; build on it for P09b/P10.

## P09b — Lens Build Kit (plan sections 8.1/15, Issue #9)

1. ID: P09b.
2. Acceptance: versioned schemas and fixture-validated ZIP layout; AnalysisRun/kit lifecycle queued to canceled with idempotent create/poll/cancel/retry/resume/expiry/tenant scope/quota; UI/REST/MCP/CLI-SDK parity over stable IDs and `skelet://lens/{id}`; 3-page fixture with desktop/mobile captures, deterministic tokens, inventory, source-linked evidence, schema-valid ZIP, starter that installs/typechecks/builds/starts and passes responsive/keyboard smoke; rights firewall; SSRF/injection/traversal/quota/cancel/outage tests; no paid inference and no P14 dependency.
3. Implementation: `packages/lens/src/kit-manifest.ts`, `kit-package.ts`, `starter-synthesis.ts`, `capture-scope.ts`, `capture-traversal.ts`, `report-assembly.ts`, `packages/db/src/build-kit.ts`, `apps/web/app/api/v1/lens/jobs/*`, `apps/web/app/lens/page.tsx`, `schemas/lens-build-kit.schema.json`, `scripts/prove_starter_consumer.mjs`, `scripts/prove_registry_install.mjs`.
4. Tests: `three-page-fixture.test.mjs`, `kit-fixture-chain.test.mjs`, `kit-manifest.test.mjs`, `kit-package.test.mjs`, `starter-synthesis.test.mjs`, `lens-jobs.test.mjs`, `lens-recovery.test.mjs`, `lens-ui.test.mjs`, `mcp-lens.test.mjs`, `no-paid-path.test.mjs`, PG `pg-build-kit.test.mjs`.
5. Verify: `node --experimental-strip-types --test packages/lens/tests/three-page-fixture.test.mjs packages/lens/tests/kit-fixture-chain.test.mjs`; `python scripts/validate_build_kit.py`; `node scripts/prove_starter_consumer.mjs --port=3127`; PG kit suite with real PostgreSQL.
6. Evidence: PRs #57–#61, #63–#65 (G09b-01–07), #73–#81 (AF-05a–g, R1, closeout); `docs/qualification/ISSUE_9_MATRIX.md` 8/8 VERIFIED; `docs/qualification/NO_MODEL_BUILD_KIT.md`; post-merge CIs SUCCESS; HEAD CI `lens` plus `db-foundation` SUCCESS.
7. Security/rights: unknown/trademark/restricted bytes withheld; ZIP traversal/CRC/method guarded; tenant denial and quota exhaustion/release; idempotent replay without double charge; PROVIDER_DISABLED parity.
8. Status: VERIFIED (with recorded scope qualifier: CLI/SDK lens operations do not exist; agents served via MCP/REST plus skill; SDK lens is NOT APPLICABLE per matrix criterion 3 where-available clause).
9. Gap: none for launch-critical kit journey.
10. Next: none; preserve contract.

## P10 — Research Corpus plus Flows (plan section 14)

1. ID: P10.
2. Acceptance (literal): authorized app/site/screen/flow import adapters; Mobbin-learned screen/flow/hotspot normalization without Mobbin runtime dependency; product/version UI, screen gallery, flow player, pattern taxonomy; rrweb for newly captured web flows; imported screens/flows coexist with pages/components/assets in one graph; flow steps reference screenshots/hotspots/actions/replay; corpus usable with all donor endpoints disabled.
3. Implementation: `packages/db/src/workflows.ts` (Flow/FlowStep CRUD), `packages/lens/src/video-frame-evidence.ts`, `jpeg-evidence.ts`, `packages/lens/src/capture-traversal.ts`, `imports/craft-suite/manifest.json` (AC-00 planning only), `apps/web/app/boards/*` (board reuse of collections, not corpus gallery).
4. Tests: `packages/db/tests/workflows.test.mjs`, `pg-workflows.test.mjs`, `packages/lens/tests/video-frame-evidence.test.mjs`, `video-evidence-attachment.test.mjs`, `capture-traversal.test.mjs`, `three-page-fixture.test.mjs`.
5. Verify: `node --experimental-strip-types --test packages/db/tests/workflows.test.mjs packages/lens/tests/video-frame-evidence.test.mjs packages/lens/tests/video-evidence-attachment.test.mjs`.
6. Evidence: AF-06-i (PR #82) bounded video-frame evidence; AF-06-ii (PR #83) video-evidence attachment with re-auth; no merged PR implements authorized app/site corpus importers, Mobbin normalization, screen gallery, flow player, pattern taxonomy, or rrweb capture; Issue #62 AC-01 remains the planned narrow frame path, not a full corpus.
7. Security/rights: video frames carry source hash/timestamps/settings/rights and no-fabricated-interaction flag; workspace/rights isolation tested; broader corpus rights matrix not yet exercised.
8. Status: PARTIAL.
9. Gap: full research corpus missing: no qualified screen/flow/hotspot importer from authorized datasets, no product/version gallery UI, no flow player, no pattern taxonomy UI/API, no rrweb representation for newly captured flows, no offline-corpus usability proof beyond fixtures.
10. Next: smallest grain AF-14a: authorized fixture corpus importer (screens plus ordered Flow/FlowStep with hotspot/action evidence) over existing workflow tables with idempotent ImportRecord, gallery read API/UI, and MCP `list_flows`/`get_flow_steps` (versioned, rights-gated); then pattern taxonomy only after corpus exists. Keep video-frame path unchanged.

## P11 — Multimodal Search plus Similarity (plan section 14)

1. ID: P11.
2. Acceptance (literal): unified SearchDocument projection; PostgreSQL FTS plus pgvector; local text/visual embedding worker with pinned open model (e.g. SigLIP2); hybrid ranking and typed filters; text-to-any, image-to-similar, artifact-to-similar; relevance benchmark fixture with thresholds.
3. Implementation: `packages/assets/src/registry.ts` deterministic lexical search, `packages/assets/tests/search.test.mjs`, `packages/assets/tests/fixtures/search-relevance.json`, `scripts/bench_search.mjs`, `apps/web/app/api/v1/assets/route.ts`, `apps/web/lib/mcp.ts` `search_assets`, `apps/web/tests/search.test.mjs`. No `packages/search`, no pgvector migration, no embedding worker, no visual index.
4. Tests: `packages/assets/tests/search.test.mjs`, `apps/web/tests/search.test.mjs`, `envelope-parity.test.mjs` search cases, `bench_search.mjs` baseline.
5. Verify: `node --experimental-strip-types --test packages/assets/tests/search.test.mjs`; `node --experimental-strip-types --test apps/web/tests/search.test.mjs`; `node scripts/bench_search.mjs`.
6. Evidence: AF-04 (PR #72) deterministic lexical search with PostgreSQL FTS; AF-00 blueprint section 24.2 and AF-02 reclassify pgvector/local embeddings as future opt-in, not mandatory for no-model core; AF-12 record does not claim embeddings; HEAD CI `assets`/`web` SUCCESS.
7. Security/rights: rights/visibility filter before rank/facets/suggestions/caching; tenant denial in search tests; no vector store to leak across workspaces.
8. Status: PARTIAL (VERIFIED only for the revised no-model lexical baseline; NOT VERIFIED for literal multimodal pgvector/SigLIP2 similarity).
9. Gap: no text embedding, no visual embedding, no image-to-similar, no artifact-to-similar, no hybrid ranker, no `find_similar` service; frozen relevance set is synthetic, not human-judged at the scale the literal plan requires. Must never label lexical/perceptual aids as semantic embeddings.
10. Next: AF-14b (only if a measured gap justifies it): deterministic perceptual-hash/aspect/color/layout/DOM-token similarity as explicit non-semantic `find_similar` baseline with frozen evaluation and CPU budget; optional customer-installed embedding plugin remains separate with its own pin/rights/perf acceptance. Do not make embeddings launch-blocking.

## P12 — MCP Apps plus Research Memory (plan section 14)

1. ID: P12.
2. Acceptance (literal): MCP App views for gallery, flow player, compare, asset picker, Lens report, reference board; project/reference-pack persistence; evidence compaction format; supported MCP App client renders interactive UI from remote server; second agent recovers every evidence object by URI.
3. Implementation: `apps/web/lib/reference-packs.ts` (`skelet/reference-pack/1`), `apps/web/lib/boards.ts`, `apps/web/app/api/v1/boards/*`, `apps/web/app/boards/page.tsx`, `apps/web/tests/boards*.test.mjs`, `mcp-boards.test.mjs`, `skills/skelet-reference-pack/SKILL.md`. No MCP Apps SDK `ui://` resources; no gallery/flow/compare/picker/report Apps views; no separate compaction format beyond reference-pack export.
4. Tests: `packages/db/tests/collections.test.mjs`, `apps/web/tests/boards.test.mjs`, `boards-ui.test.mjs`, `mcp-boards.test.mjs`, `mcp.test.mjs` pack round-trip, `envelope-parity.test.mjs`.
5. Verify: `node --experimental-strip-types --test apps/web/tests/boards.test.mjs apps/web/tests/mcp-boards.test.mjs`; `python scripts/validate_skills.py`.
6. Evidence: AF-07-i (PR #84) board ranks/move, AF-08-i (PR #85) board REST, AF-08-ii (PR #86) board operator UI, AF-09-i/ii (PRs #87–#88) handoff/ledger and REST/MCP/UI parity; Issue #62 AC-02 selective moodboard transplant NOT performed (Skelet-owned ordered-collections board instead); HEAD CI `web`/`db-foundation` SUCCESS.
7. Security/rights: collection ownership/handoff ledger with item validation; two-workspace denial; tombstones; offline draft behavior covered by board tests; no hosted-media embedding in packs.
8. Status: PARTIAL.
9. Gap: MCP Apps layer missing; flow player/compare/gallery/picker/Lens-report Apps views missing; evidence compaction is reference-pack export only, not a versioned bounded compaction format with citation/rights/freshness/missing-data semantics at the level AF-09 blueprint section 9 requires; ArtCraft moodboard grid/canvas/presentation/history/snap module not transplanted (deferred by design, not yet proven unnecessary with measurements).
10. Next: AF-14c: versioned evidence-compaction pack format plus `get_reference_pack` MCP/REST parity with stale/tombstone semantics; then, only with measured need, AC-02 narrow board-core transplant behind SkeletAdapter (client-only, rights-filtered, a11y/SSR-gated). Do not create an alternate board database.

## P13 — Time Machine plus Change Intelligence (plan section 14)

1. ID: P13.
2. Acceptance: scheduled/explicit recapture policy; page/screenshot/token/text/flow diff pipeline; normalized change events and meaningful-change scoring; watch/`get_changes` API/MCP; two ProductVersions yield evidence-linked change events without model prose; cosmetic versus structural changes distinguishable by deterministic signals plus optional enrichment.
3. Implementation: none found. `rg get_changes` returns only plan/blueprint/skill references, no route/tool/migration. No diff pipeline, no change-event tables, no watch API.
4. Tests: none.
5. Verify: `rg -n "get_changes|change-event| meaningful-change" apps packages --glob '!node_modules'` returns no implementation; `node --experimental-strip-types --test` has no P13 suite.
6. Evidence: no merged P13 PR in #1–#91; #34 frontier lists P13 as future; commercial launch explicitly MUST NOT be blocked by P13 per plan section 15.
7. Security/rights: not applicable beyond future tenant-scoped diff access and takedown-aware event purge (to be specified in implementation grain).
8. Status: NOT STARTED.
9. Gap: entire P13 capability missing; this is authorized deferral for initial launch, not a launch blocker, but it is not verified.
10. Next: defer implementation until after P08/P10/P11 gaps; when started, smallest grain AF-15a: deterministic page/token/screenshot diff over two qualified ProductVersions with evidence-linked events and `get_changes` read API (rights-gated), before any scheduling or scoring.

## P14 — Create Beta via OpenPencil (plan section 14)

1. ID: P14.
2. Acceptance (literal, gated by stable P08–P12): reference-pack to OpenPencil document adapter; editable design generation via OpenPencil APIs/MCP (not a new canvas); .fig/.pen export/import where supported; design-token handoff; qualified pack turns into editable document; adapter isolated so Create evolves independently.
3. Implementation: `packages/editor-adapters/src/vector-adapter.ts` (VectorCraft headless `convert`/`info`/`commands`, `tokensToSvg`, `inspectSvg`), `raster-adapter.ts` (PhotoCraft headless `convert`/`info`/`commands`, magic-byte validation), `src/index.ts` public surface. No OpenPencil adapter; no `.fig`/`.pen` path; no reference-pack-to-document workflow; PageDraw primitives explicitly not transplanted (see raster-adapter.ts boundary note).
4. Tests: `packages/editor-adapters/tests/vector-adapter.test.mjs`, `raster-adapter.test.mjs` (48/48 per AF-12 record; fixture executables only).
5. Verify: `node --experimental-strip-types --test packages/editor-adapters/tests/vector-adapter.test.mjs packages/editor-adapters/tests/raster-adapter.test.mjs`; `pnpm --filter skelet-editor-adapters lint`; `pnpm --filter skelet-editor-adapters typecheck`.
6. Evidence: AF-10 (PR #89) vector adapter; AF-11 (PR #90) raster/PageDraw-boundary adapter; both disabled-by-default, root-confined, allowlisted argv, scrubbed env, timeouts/output caps; fixture success explicitly NOT upstream binary proof; UPSTREAMS pins `vectorcraft 6c3f9f60aa69ac151f9908b94cf00a387746eea4`, `photocraft 97136485f0743251ab330d096ca6c9d0f0f6f54c`; HEAD CI `editor-adapters` SUCCESS.
7. Security/rights: absolute-path-only binaries (no PATH hijack), realpath confinement, refused `run`/`mcp`/`bench`/`batch`/`serve`, no shell/TCP/ambient secrets, SVG script/foreignObject/entity refusal, raster magic-match, per-job budgets, provenance `local`/`free-local`.
8. Status: PARTIAL.
9. Gap: OpenPencil path missing; no pack-to-editable-document journey; no `.fig`/`.pen`; genuine upstream VectorCraft/PhotoCraft binary execution UNVERIFIED (fixture-only); PageDraw conditional transplant not started (correctly deferred pending gap proof).
10. Next: Issue #62 disposition below governs P14. Do not claim fixture tests as upstream compatibility. Next executable grain is upstream-binary qualification only if a free, reproducible, safe binary can be obtained (see section Issue #62); otherwise proceed with OpenPencil adapter scoping after P08–P12 stabilize. P14 remains non-blocking for initial launch per plan.

## P15 — Commercial Launch Qualification (plan section 14)

1. ID: P15.
2. Acceptance: pricing/capability enforcement; production R2/S3 adapter; dashboards, rate limits, abuse controls, backups, restore drill; migration/runbook; privacy/terms/support; load tests for search/Lens/media/MCP; restore succeeds; SLOs/alerts documented; critical journeys pass on production-like env; zero blocking Jev/OCR.
3. Implementation: `packages/db/src/billing.ts` capability model, `apps/web/lib/rate-limit.ts`, `packages/storage` filesystem plus S3-compatible adapter interface (local exercised; R2/S3 not exercised), `scripts/smoke-web.mjs`, `scripts/prove_starter_consumer.mjs`, `scripts/prove_registry_install.mjs`, `docs/qualification/AF-12_RELEASE_QUALIFICATION.md` (AF-12i hygiene scope).
4. Tests: `packages/db/tests/billing.test.mjs` (signed webhook/replay/seats fixture), rate/quota cases in `envelope-parity`, `mcp`, `rest`, `lens-jobs`, `mcp-lens`, `build-kit` suites; no load suite, no restore-drill suite, no production-migration rehearsal suite.
5. Verify: `python -m unittest discover -s tests`; `pnpm install --frozen-lockfile`; full workspace lint/typecheck/test matrix per AF-12 record; `node scripts/smoke-web.mjs 3103`; `node scripts/prove_registry_install.mjs`.
6. Evidence: AF-12i (PR #91) measured sweep plus honest limitations section; HEAD CI `38502030267` SUCCESS 15/15; `docs/reviews/AF-12i_*`; no merged PR for R2/S3 production exercise, dashboards, restore drill, SLOs, or load tests.
7. Security/rights: capability model independent of hard-coded prices; quotas enforced in tests; production abuse/egress/backup/takedown operations not yet proven at scale.
8. Status: PARTIAL.
9. Gap: production storage exercised only as interface plus local adapter; no restore drill; no migration runbook rehearsal; no SLO/alert documentation; no search/Lens/media/MCP load tests; no privacy/terms/support surfaces review; no signed SBOM/release artifact called out in evidence.
10. Next: AF-12 follow-on grains: (a) self-hosted distribution proof (clean-machine no-model/no-paid-cloud install-to-health with pinned toolchain); (b) backup/restore plus takedown/derivative-purge drill; (c) quota/abuse/limits plus operation runbook; (d) load baselines for search/Lens/media/MCP before any hosted offer. Managed SaaS remains explicitly not offered until budgeted per AF-00.

---

## R0 — Provenance

1. ID: R0.
2. Acceptance: every donor binds to immutable commit/release/hash at execution; code vs data/asset/model/service/trademark scopes separated; per-capability dependency closure; preserved notices; malformed/mutable entries fail validation; per-item serving policy.
3. Implementation: `UPSTREAMS.lock.yml` (38 sources per AF-12 record), `schemas/upstreams.schema.json`, `CODE_PROVENANCE.md`, `DATA_PROVENANCE.md`, `docs/provenance/*`, `imports/craft-suite/manifest.json` plus `donor-pins.json`, `scripts/validate_upstreams.py`.
4. Tests: `tests/test_validate_upstreams.py`, `tests/test_monet_import_manifest.py`, `tests/test_craft_audit_af01.py`, `tests/test_monet_dependency_closure.py`.
5. Verify: `python scripts/validate_upstreams.py`; `python -m unittest discover -s tests -v`.
6. Evidence: AF-01 (PR #67) immutable craft-suite audit; G00-02 plus G01 grains; HEAD CI `bootstrap` SUCCESS.
7. Security/rights: no branch-name-only pins; third-party exclusions preserved; source permission never implies asset/model/trademark rights.
8. Status: VERIFIED (for code/source provenance in repo; dataset/asset/model/trademark permissions remain per-item gates at serving time, covered by R3–R6 tests).
9. Gap: none for R0 mechanism; keep enforcing at every future import.
10. Next: none; block any future grain with ambiguous provenance.

## R1 — Runnable Shell

1. ID: R1.
2. Acceptance: clean checkout installs; strict lint/typecheck/build; app starts and health/smoke passes; no donor-content dependence for shell.
3. Implementation: `apps/web/app/api/health/route.ts`, `apps/worker` health command, `pnpm-workspace.yaml`, `package.json`, `pnpm-lock.yaml`, `scripts/smoke-web.mjs`.
4. Tests: `apps/web/tests/health-route.test.mjs`, `apps/worker/tests/cli.test.mjs`, `env.test.mjs`, CI `web`/`worker` jobs.
5. Verify: `pnpm install --frozen-lockfile`; `pnpm --dir apps/web lint && pnpm --dir apps/web typecheck && pnpm --dir apps/web build`; `node scripts/smoke-web.mjs 3103`; `pnpm --dir apps/worker start health`.
6. Evidence: G01-03a/b, G02-02, plus every subsequent exact-head CI; AF-12 record production build PASS plus SMOKE_OK; HEAD CI `web`/`worker` SUCCESS.
7. Security/rights: health exposes no secrets; smoke uses ephemeral ports and shuts down.
8. Status: VERIFIED.
9. Gap: none.
10. Next: none.

## R2 — Tenant/Domain/Storage

1. ID: R2.
2. Acceptance: workspace roles and server-side authorization on every read/write; forged IDs denied; expired sessions denied; anonymous writes denied; content-addressed storage with dedupe; idempotent domain writes; quotas/rate limits not bypassable via alternate interfaces.
3. Implementation: `packages/db/src/auth.ts`, `workspaces.ts`, `collections.ts`, `artifact-access.ts`, `idempotency.ts`, `packages/storage/src/*`, `apps/web/lib/rate-limit.ts`, `apps/web/lib/boards.ts` ownership/handoff.
4. Tests: `auth.test.mjs`, `workspaces.test.mjs`, `collections.test.mjs`, `artifact-access.test.mjs`, `jobs.test.mjs` idempotency, board two-workspace denial, `envelope-parity`/`rest`/`mcp` denial parity, storage dedupe tests.
5. Verify: `node --experimental-strip-types --test packages/db/tests/auth.test.mjs packages/db/tests/workspaces.test.mjs packages/db/tests/collections.test.mjs packages/db/tests/artifact-access.test.mjs packages/storage/tests/storage.test.mjs`.
6. Evidence: PRs #23–#26, AF-SEC-00 (PR #66) actor-scoped reads, AF-09 handoff ledger (PRs #87–#88); HEAD CI `db-foundation`/`web` SUCCESS.
7. Security/rights: title/rights metadata treated as private; search/cache/preview/board/export/pack paths all gated by same central check (no per-interface fork).
8. Status: VERIFIED (for implemented surfaces; new surfaces must reuse the same gate, which is a future-grain obligation, not a current failure).
9. Gap: every new read path (including future `find_similar`/`compare_design`/`get_changes`/Apps) must add denial fixtures before exposure.
10. Next: enforce R2 fixtures in each upcoming feature grain; no separate R2 project.

## R3 — S0 End-to-End (no-model)

1. ID: R3.
2. Acceptance: rights-cleared fixture flows through ingest, canonical persistence, search, human inspection, collection save, reference-pack export, and REST/MCP recovery from another client, with authenticated and anonymous negative tests and zero external model.
3. Implementation: fixture corpus plus `packages/ingest`, `packages/assets`, `packages/db`, `apps/web/lib/reference-packs.ts`, `apps/web/lib/mcp.ts`, `apps/web/app/api/v1/*`, `skills/*`, `scripts/check_no_model.py`, `packages/no-model`.
4. Tests: `publish.test.mjs`, `assets/search.test.mjs`, `apps/web/tests/search.test.mjs`, `mcp.test.mjs` pack round-trip, `interop-http/stdio`, `rest.test.mjs`, `envelope-parity.test.mjs`, `no-paid-path.test.mjs`, `no-model.test.mjs`, `tests/test_no_model.py`.
5. Verify: `SKELET_NO_MODEL=1 python scripts/check_no_model.py --root .`; `SKELET_NO_MODEL=1 pnpm --dir apps/worker start health`; `node --experimental-strip-types --test packages/no-model/tests/no-model.test.mjs packages/lens/tests/no-paid-path.test.mjs`; full pack round-trip suites.
6. Evidence: AF-02 (PR #68) zero-model/egress conformance, AF-03a–c (PRs #69–#71), AF-04 (PR #72), `docs/qualification/NO_MODEL_BUILD_KIT.md`; HEAD CI `no-model` SUCCESS.
7. Security/rights: private content never enters external model path; deterministic path succeeds with all provider secrets missing; AnalysisRun egress classification where external inference is used.
8. Status: PARTIAL.
9. Gap: S0 is evidenced on synthetic/rights-cleared fixtures and implemented tools, but not on a qualified real research corpus with product/version gallery, flow player, and pattern taxonomy (P10 missing), nor on the full literal tool set (P08 gaps). Anonymous/authenticated negative coverage exists for implemented paths but cannot cover unimplemented corpus/Apps surfaces.
10. Next: close via AF-14a corpus importer plus AF-13a/b agent-tool additions; then re-run S0 as a named golden journey with 3 clients and record it as R3 evidence.

## R4 — Guarded Lens

1. ID: R4.
2. Acceptance: URL capture security matrix (localhost/127/8, IPv6 loopback/link-local/private, RFC1918, CGNAT, metadata, public-DNS-to-private, redirect-to-private, rebinding, file/data/javascript/ftp schemes, oversize, redirect loop, timeout/cleanup, SVG/HTML isolation, worker secret isolation) plus prompt-injection-as-data and egress-off deterministic path.
3. Implementation: `packages/lens/src/url-guard.ts`, `capture-network.ts`, `capture-child.ts`, `capture-worker.ts`, `report-assembly.ts`, `export-surface.ts`.
4. Tests: `url-guard.test.mjs`, `capture-network.test.mjs`, `capture-browser.test.mjs`, `report-assembly.test.mjs` (hostile stays data), `export-surface.test.mjs`, `no-paid-path.test.mjs`.
5. Verify: `node --experimental-strip-types --test packages/lens/tests/url-guard.test.mjs packages/lens/tests/capture-network.test.mjs packages/lens/tests/capture-browser.test.mjs packages/lens/tests/report-assembly.test.mjs`.
6. Evidence: G09-01–G09-03 plus AF-05e/g; ISSUE_9_MATRIX criterion 6; AF-12 record lens 197/197; HEAD CI `lens` SUCCESS.
7. Security/rights: fail-closed resolver/redirect/rebind/subresource posture; isolated secret-free child proven by test; no prod cookies/keys in worker.
8. Status: VERIFIED.
9. Gap: none for qualified Lens report path; P09b inherits R4.
10. Next: none; require R4 fixtures in every future capture change.

## R5 — Qualified Corpus/Search and Agent Interoperability

1. ID: R5.
2. Acceptance: corpus remains usable with donor endpoints disabled; lexical baseline with frozen relevance judgments before any vector model; exact model/runtime pins, CPU/RAM/time benchmarks, egress-off fallback, no mandatory GPU; 3-host MCP matrix with OAuth/audience/PKCE/issuer where remote, Tasks optional with REST fallback; no second canonical search contract.
3. Implementation: lexical search stack (see P11), `packages/db` corpus tables, `imports/*` manifests, `apps/web/lib/agent-contract.ts` `skelet.agent.v1`, `scripts/mcp_stdio.mjs`, SDKs/CLI, `docs/qualification/ISSUE_9_MATRIX.md` criterion 7 donor posture.
4. Tests: frozen `search-relevance.json` plus search suites, `bench_search.mjs`, `interop-http.test.mjs`, `interop-stdio.test.mjs`, `test_mcp_interop_py.py`, SDK envelope tests, `validate_agent_contract.py`.
5. Verify: `node scripts/bench_search.mjs`; `python scripts/validate_agent_contract.py`; interop suites in `apps/web/tests/`.
6. Evidence: AF-03c three-wire-client proof; AF-04 lexical baseline; AF-01 donor evaluation-first posture; HEAD CI `web`/`sdk`/`bootstrap` SUCCESS.
7. Security/rights: rights filter before rank; no silent vector/GPU dependency; temporary Monet/Orama logic, if any, stays behind migration adapter and never becomes canonical.
8. Status: PARTIAL.
9. Gap: corpus is fixtures/synthetic, not an authorized real product corpus; relevance judgments are frozen synthetic, not human-judged at launch scale; semantic/visual embeddings correctly absent but therefore literal multimodal acceptance is unmet; remote OAuth/PKCE/issuer hardening for hosted remote MCP is planned but local/stdio plus bearer-gated HTTP is the evidenced path (managed remote remains future per AF-00 deployment contract).
10. Next: AF-14a corpus plus AF-14b deterministic similarity baseline; remote hardening only if a customer-hosted remote offer is scoped. Do not claim hosted SaaS readiness.

## R6 — Local/Paid Beta Security plus Operations

1. ID: R6.
2. Acceptance: quotas/CPU/bytes/rate limits and abuse alarms/kill-switch; browser-minute/storage/egress cost attribution and margin evidence; retention/backup/purge/restore with RPO/RTO; signed webhooks with replay/out-of-order/downgrade/seat/quota handling; takedown plus derivative/cache purge end-to-end; runtime integrity/SBOM/least-privilege CI.
3. Implementation: `apps/web/lib/rate-limit.ts`, kit/board quotas in `build-kit.ts`/`boards.ts`/`lens-jobs`, `packages/db/src/billing.ts` webhook intake, `packages/lens` expiry/purge paths, CI pinned SHAs plus frozen installs.
4. Tests: quota-exhaustion/release, idempotent replay, cancel/retry/resume, download/purge denial, billing webhook replay/out-of-order, tombstone/purge cases across `lens-jobs`, `mcp-lens`, `build-kit`, `billing`, `boards` suites.
5. Verify: quota/replay/purge subsets of the suites above; `python -m unittest discover -s tests`; exact-head CI.
6. Evidence: AF-05c/f/g quota/expiry/reaper coverage; AF-05e download/purge; AF-09 handoff ledger; AF-12i hygiene; HEAD CI SUCCESS. No merged restore-drill, cost-dashboard, or load-proof PR.
7. Security/rights: per-user/workspace/API quotas; unapproved egress denied in no-model gate; takedown removes bytes plus derivatives/thumbnails/caches where implemented (kit/board paths), but full lifecycle purge across OCR/embeddings/CDN remains unproven because those stores do not exist in the no-model core.
8. Status: PARTIAL.
9. Gap: no backup/restore drill; no RPO/RTO proof; no browser-minute/storage/egress unit-economics dashboard; no abuse alarm/kill-switch beyond test-level quota denial; no production R2/S3 backup; no signed release/SBOM called out.
10. Next: AF-12 follow-on operations grain (backup/restore/takedown drill plus runbook) before any paid/hosted claim. Local single-user remains the only supported zero-founder-spend mode per AF-00.

## R7 — Release Correctness

1. ID: R7.
2. Acceptance: signed release, SBOM, dependency/secret scans, migration rehearsal, restore and incident exercise; SLOs/alerts documented; critical journeys pass on production-like env; zero blocking Jev/OCR.
3. Implementation: `.github/workflows/ci.yml` 15-job exact-head gates, `scripts/ci_hygiene.py` binary/secret guardrails, `requirements-ci.txt` hashed pins, `pnpm-lock.yaml` frozen installs, migration-tested DB suites, smoke/consumer/registry proofs.
4. Tests: `tests/test_ci_hygiene.py`, migration suites, `smoke-web.mjs`, `prove_starter_consumer.mjs`, `prove_registry_install.mjs`, per-grain Jev/OCR/PStack/Graft records under `docs/reviews/`.
5. Verify: `gh run view 38502030267 --json conclusion,jobs`; `python scripts/ci_hygiene.py --expected-head 543641a43c6a8b2b2c745d6323b0c71e4874ca35`; full local qualification matrix per AF-12 record.
6. Evidence: PR #91 plus all per-grain `docs/reviews/AF-*` and `G*` records; HEAD CI SUCCESS. AF-12i honestly scopes itself to hygiene plus measured sweep and defers matrix/#62 to follow-ons.
7. Security/rights: exact-HEAD checkout enforcement; no force-push/squash/rebase on governed branches; normal merges only; post-merge verification required.
8. Status: PARTIAL.
9. Gap: R7 is not satisfied by CI alone: no signed release artifact, no SBOM in evidence, no dependency/secret scan report beyond hygiene pins, no migration upgrade/revert rehearsal record, no restore/incident exercise, no SLO/alert document, no production-like critical-journey run after final code.
10. Next: AF-12 release grain must add SBOM plus scan reports, migration rehearsal, restore drill, SLO/alert doc, and a named final qualification rerun on the release candidate HEAD. Do not declare release-complete on green CI alone.

---

## Issue #62 — ArtCraft Disposition (separate from P-status above)

Accepted program: Issue #62 AC-00–AC-04 with 7 global gates and 3 journeys. AF-01/AF-06/AF-07/AF-08/AF-10/AF-11 are partial satisfactions, not closeout.

- AC-00 qualified inventory and import design: PARTIAL. `imports/craft-suite/manifest.json` plus `donor-pins.json` and AF-01 audit (`docs/reviews/AF-01_*`, `tests/test_craft_audit_af01.py`, `UPSTREAMS.lock.yml` vectorcraft/photocraft/designcraft/effectcraft/filmcraft/lightcraft/artcraft entries) establish source shortlist, license distinction (dual-licensed artcraft preferred over restrictive services snapshot; 8-blob equivalence check), and include/exclude posture. Remaining: per-file transitive closure (CSS/tokens/fonts/WASM/assets/API calls), measured bundle/perf baseline, and frozen benchmark fixtures for each transplant candidate. Do not start runtime transplant until AC-00 per-file manifests land.
- AC-01 P10 video reference import: PARTIAL. AF-06-i/ii implement a Skelet-owned bounded frame engine with budgets/provenance/no-fabricated-interaction, not the ArtCraft `extract-frames.ts` transplant. Journey (a) video to timestamped artifacts/flow is exercisable on fixtures. Remaining: explicit gap decision for ArtCraft frame-extractor (adopt versus keep Skelet-owned after measured comparison) with hash-level source comparison if adoption is proposed.
- AC-02 P12 reference boards: PARTIAL. AF-07/08/09 implement Skelet-owned ordered-collections board domain, REST/MCP/UI parity, and handoff ledger. The selective ArtCraft moodboard transplant (grid/canvas/presentation/history/snap/serialization behind SkeletAdapter, client-only, rights-filtered, a11y/SSR-gated) is NOT performed. Journey (b) search/Lens to collaborative board to reload to cross-agent pack passes on the Skelet-owned board, not on transplanted moodboard code. Remaining: measured decision whether transplant beats existing board; if yes, narrow transplant grain with full manifest and regression gates.
- AC-03 P14 vector/raster adapters: PARTIAL. AF-10/11 deliver disabled-by-default, root-confined, allowlisted headless adapters with deterministic errors and fixture-tested journeys (reference-pack plus DTCG to SVG to reopen to Asset; raster convert to reopen). Genuine upstream VectorCraft/PhotoCraft binary execution is UNVERIFIED by the adapters own boundary notes and AF-12i limitations. PageDraw local primitives are explicitly NOT transplanted. Remaining: (i) genuine binary qualification only through an authorized, free, reproducible workflow (pin-matched `vectorcraft-cli`/`photocraft-cli` installed by operator, same suites rerun, hashes recorded), or a documented blocked-with-cause record distinguishing fixture-verified adapter behavior from upstream compatibility; (ii) OpenPencil/`.fig` path remains P14 scope, not AC-03.
- AC-04 post-launch evaluation: DEFERRED by design (DesignCraft/EffectCraft/FilmCraft/LightCraft/PageScene/video-editor). No launch delay. Each requires benchmark-justified future grain; never counted complete.
- Global gates: (1) no architectural inversion holds so far (PostgreSQL/graph/storage/auth/quota/MCP/REST/rights authoritative; no MySQL/Redis/Elasticsearch transplant); (2) rights fail closed holds for implemented paths; (3) agent parity holds for implemented objects via stable `skelet://` URIs, but missing tools/surfaces from P08/P10–P13 are parity gaps, not passes; (4) performance has no board/import latency baseline on constrained hardware (rollback criterion unmeasurable until AF-01 perf cap lands); (5) tests/reviews discipline holds per grain (genuine Jev, delegate-only OCR labeled non-LLM, PStack manual fallback labeled, Graft, exact-head CI, normal merge, post-merge CI); (6) no launch disruption holds; (7) Skelet identity holds with provenance/NOTICE preserved.
- Journeys: (a) PARTIAL-pass on Skelet-owned frames (not ArtCraft code); (b) PARTIAL-pass on Skelet-owned board (not transplanted moodboard); (c) PARTIAL-pass fixture-only (pack plus DTCG to editable SVG to reopen to Asset) with upstream binary UNVERIFIED.

Disposition: Issue #62 stays OPEN. It may close only when AC-00 per-file manifests plus AC-01/AC-02 measured adopt/keep decisions plus AC-03 genuine-binary qualification (or an explicitly authorized evidence-backed blocked-with-cause record that separates fixture-verified behavior from upstream compatibility without downgrading mandatory criteria) plus AC-04 explicit accept/defer records are all committed, or when an owner-authorized disposition with the same evidence exists. Continuing independent P08/P10–P13/P15 work is required while any ArtCraft item is blocked.

---

## Verified Coverage Calculation (from rows above, no invented percent)

- Total rows: 25 (P00–P15 inclusive is 16 phases plus P09b equals 17 phase rows; R0–R7 equals 8 control rows).
- VERIFIED: 14 (P00, P01, P02, P03, P04, P05, P06, P07, P09, P09b, R0, R1, R2, R4).
- PARTIAL: 10 (P08, P10, P11, P12, P14, P15, R3, R5, R6, R7).
- NOT STARTED: 1 (P13).
- NOT APPLICABLE: 0 (no phase is excluded; P13/P14 deferrals are authorized scope delays, not exclusions; SDK-lens-only NOT APPLICABLE qualifier lives inside P09b and does not remove P09b from coverage).
- Coverage: 14/25 VERIFIED (56.0%). Remaining actionable rows: 11.

## Highest-Priority Next Grains (work queue, not a plan to stop after)

1. AF-13a `find_similar` deterministic baseline plus `compare_design` evidence diff (P08/R3/R5; R2 denial fixtures required).
2. AF-14a authorized fixture corpus importer plus `list_flows`/`get_flow_steps` and gallery reads (P10/R3/R5).
3. AF-13b `resolve_asset`/`search_registry` MCP parity plus `analyze_image` job path (P08/R3).
4. AF-14c versioned evidence-compaction pack plus `get_reference_pack` parity with tombstones (P12/R3).
5. AF-14b deterministic similarity evaluation hardening (P11; only expand to optional embedding plugin with separate pin/rights/perf acceptance if measured gap justifies it).
6. AC-00 per-file manifests plus perf baseline (Issue #62; blocks any transplant).
7. Genuine upstream binary qualification or blocked-with-cause record for VectorCraft/PhotoCraft (Issue #62 AC-03; never represent fixtures as upstream proof).
8. AF-12 operations grain: backup/restore/takedown drill plus runbook (P15/R6).
9. AF-12 release grain: SBOM/scans, migration rehearsal, SLOs/alerts, load baselines, final qualification rerun (P15/R7).
10. P13 `get_changes` deterministic diff only after corpus exists (AF-15a; explicitly deferred, not launch-blocking).

---

## Post-Audit Deltas (append-only; the rows above remain the audit of `543641a`)

- PR #92 (`ce6ba14`, CI SUCCESS 15/15 exact-head and post-merge): this matrix document itself plus review records. No product change.
- PR #93 (`b2de7b3`, CI SUCCESS 15/15 both): AF-13a-i deterministic `find_similar` (MCP + REST + skill + CI). P08 gap #1 closed; P08 row otherwise unchanged.
- PR #94 (`0ebd53d`, CI SUCCESS 15/15 both): AF-13a-ii observed `compare_design` (MCP + REST + skill + CI). P08 gap #2 closed; P08 row otherwise unchanged (still PARTIAL: `get_changes`, MCP Apps).
- PR #95 (`b745a3e`, CI SUCCESS 15/15 both): AC-00-i moodboard closure (70 SHA-verified files, 8 externals, SmartSearchBar excluded). Issue #62 AC-00 partially advanced; no transplant authorized.
- Genuine VectorCraft binary qualification (`docs/qualification/VECTORCRAFT_BINARY_QUALIFICATION.md`): converts the AF-10 adapter's upstream compatibility from UNVERIFIED to VERIFIED at commit `6c3f9f60aa69ac151f9908b94cf00a387746eea4` for `convert`/`info`/`commands` plus refusal paths. PhotoCraft genuine-binary qualification remains open. Fixture suites remain the CI story; this record is the upstream-compatibility evidence.
- Genuine PhotoCraft binary qualification (`docs/qualification/PHOTOCRAFT_BINARY_QUALIFICATION.md`): converts the AF-11 adapter's upstream compatibility from UNVERIFIED to VERIFIED at commit `97136485f0743251ab330d096ca6c9d0f0f6f54c`, inclusive of two genuine defects the fixtures missed and the fix grain repaired (`commands --json`; bare `--tiff-layers` flag with `flatten` sending nothing). AC-03 adapter qualification is complete for VectorCraft and PhotoCraft at their pins; PageDraw stays deferred, OpenPencil stays P14 scope.
- PR #97 (`3d061b0`, CI SUCCESS 15/15 both): AF-11 genuine raster fix (the two argv defects above) with regression tests; PhotoCraft compatibility VERIFIED. No other surfaces changed.
- PR #98 (`4e23f70`, CI SUCCESS 15/15 both): AF-14a authorized corpus importer (validate-first, ledger-idempotent, conflict-closed) with migration 016 (flow ledger targets, guards, rollback proven on PGlite and real PostgreSQL), `list_flows`/`get_flow_steps` MCP tools plus two REST routes (deep-equal parity), research skill step, inventory 18->20. P10 framework gap closed; gallery UI, flow player, taxonomy, and rrweb remain follow-ons.
- AF-12 operations drill (`packages/db/src/backup.ts` + `docs/operations/RUNBOOK.md`): corpus-subgraph snapshot/wipe/restore with ID-preserving re-insert and per-table verification, proven on PGlite and real PostgreSQL (CI `db-foundation` job). Production backup stays `pg_dump` plus store snapshot per the runbook; per-item takedown automation beyond kit/board purge paths remains a follow-on with the manual procedure defined here.
- AF-12 release evidence (unified: `package.json` postcss override + root `sbom.json` via `scripts/generate_sbom.py` + `tests/test_sbom.py` + `DEPENDENCY_SCAN.md` + `AF-12_RELEASE_HARDENING.md` + `SLOS.md` + `migration-rehearsal`): pnpm override pins `postcss` to `8.5.30`, closing 4 audit advisories (post-change `pnpm audit`: 1 remaining, braces dev-only accepted risk with revisit trigger); committed 380-component CycloneDX SBOM (freshness-enforced by `--check` plus 4 conformance tests); full migration up/down/up rehearsal proven on scratch hardware (CI `db-foundation` job) plus real-PG 16↔16 record; SLO targets with measured lexical baseline (p95 ~10.5 ms on 200 records, PGlite) and operator-verifiable objectives. Final release qualification stays a separate follow-on.
- AF-12 final qualification (`AF-12_FINAL_QUALIFICATION.md`, base `8027264`): full measured sweep rerun with zero failures (lint/typecheck 11/11, python 182/182, node web/worker 114/114, assets 33/33, ingest 14/14, providers group 39/39, adapters 50/50, lens 197/197 incl. real Chromium, db non-PG 116/116, real PG 15/15 on fresh fixture DBs, all validators plus SBOM-check plus hygiene PASS, 1 remaining audit advisory under accepted risk, web build plus SMOKE_OK plus STARTER_CONSUMER_OK plus REGISTRY_INSTALL_PROOF_OK, graft green). No product change needed. Ends with honest limitations and a matrix-referenced verdict, not a standalone release declaration.
- AF-13b-i deterministic `search_registry` (MCP + REST + skill + CI): substring search over the static component index (index-ordered, bounded, empty-query lists all) with `searchRegistryRoute` deep-equal parity, skill step, validator promotion (`search_registry` implemented), inventory 20->21. P08 gap closed for registry discovery; `resolve_asset`/`analyze_image`/`get_changes`/MCP Apps remain.
- AF-13b coverage (`AF-13B_COVERAGE.md`, docs-only with re-proven suites): `resolve_asset` intent covered by `get_asset` + `get_object` (no read-time ambiguous namespace exists; separate verb would duplicate or mistarget), verified by mcp 11/11 plus parity 14/14 plus rest 5/5; `analyze_image`/`analyze_url` intent covered by the qualified Lens job path with single-shot explicitly deferred per skill gating and validator. `get_changes`/MCP Apps/compaction stay open.

---

## Audit Limitations

- This matrix is a documentation audit on HEAD `543641a`. It implements no product code and closes no P0 risk by itself.
- Counts above derive from row statuses in this file, not from test-suite pass counts. Suite totals cited (e.g. Python 170, lens 197) are historical AF-12i measurements to be re-run on the final release candidate; they are not re-verified by this document.
- Real upstream adapter binary compatibility remains UNVERIFIED as of the `543641a` audit; see Post-Audit Deltas for the VectorCraft and PhotoCraft genuine-binary qualifications that supersede this line. Fixture-tested adapters must never be cited as upstream proof.
- Alibaba OCR delegate-only results are non-LLM delegations, not independent model-backed reviews, per every `*_OCR_DELEGATION.md`.
- PStack evidence to date is fresh-context manual review explicitly labeled as fallback, not genuine tool execution, where the binary was unavailable.
- Managed SaaS, production R2/S3 at scale, enterprise SSO/SCIM, and GPU paths are out of scope for the supported zero-founder-spend local/self-hosted core and were not exercised.
