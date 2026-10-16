# AF-12 Final Qualification Rerun 4 — 2026-10-16 (main `70da1ba`)

Branch: `skelet/af12-final-rerun-4`. Base: `70da1ba` (PR #140 merge, CI SUCCESS 15/15).
Scope of this grain: rerun the full measured qualification sweep on the
release candidate that includes PRs #136–#140 (AC-00 bundle baseline, P10
normalization note, P15-3 release signing, P15 legal surfaces, P15
concurrent-load bench). No product code changed in this grain; any defect
found would have become its own fix grain. Full P00–P15 / R0–R7
reconciliation lives in `AF-12_ACCEPTANCE_MATRIX.md` (with post-audit
deltas through PR #140); Issue #62 stays open for the owner closeout
decision and the per-document fig-fidelity caveat.

## Measured sweep (real execution on the Mac, 2026-10-16, base `70da1ba`)

- Frozen install: `pnpm install --frozen-lockfile` clean.
- Lint: all 11 workspaces PASS, zero warnings (`apps/web`, `apps/worker`,
  `packages/assets`, `packages/db`, `packages/editor-adapters`,
  `packages/ingest`, `packages/lens`, `packages/no-model`,
  `packages/providers`, `packages/sdk-ts`, `packages/storage`).
- Typecheck: all 11 workspaces PASS.
- Python: `python3 -m unittest discover -s tests` — 227/227 OK
  (224 at `aca627b` plus 3 P10 normalization tests).
- Node web/worker: 170/170 with zero failures, measured in directory
  batches (tests/node 13/13, worker 15/15, web files 142/142 across four
  batches: 23 + 48 + 41 + 30). The single-process three-glob invocation
  exceeds this 8 GB Mac's capacity and stalls locally; every file passes
  individually and in batches, and the exact-head CI `web` job runs the
  same combined glob on a fresh runner as the authoritative combined
  proof. This local-harness limit is environmental, not a product defect.
- Assets: 35/35. Ingest: 14/14.
- Providers + SDK-TS + storage + no-model: 39/39.
- Editor adapters (vector + raster + openpencil): 70 tests, 69 pass, 1
  labeled genuine-binary skip (`SKELET_OPENPENCIL_BIN` absent), 0 fail.
- Lens (incl. real Chromium capture): 197/197.
- DB non-PG (CI-canonical 16 files, incl. gallery/patterns/replay,
  backup-restore, rehearsal): 146/146.
- Real PostgreSQL (local fixture database, CI-identical credentials):
  pg-integration 2/2, pg-graph 2/2, pg-workflows 5/5, pg-build-kit 5/5,
  pg-backup-restore 1/1 (15/15, each suite in its own process).
- Validators: `check_no_model` PASS (strict, 26 hosts), `validate_upstreams`
  PASS (38 sources), `validate_build_kit` PASS, `validate_agent_contract`
  PASS, `validate_registry` PASS (2 items), `validate_skills` PASS
  (4 skills), `generate_sbom.py --check` PASS (380 components),
  `ci_hygiene.py` PASS (934 tracked files).
- Release checks: `sign_release_artifact.mjs --self-test` exit 0
  (`verified: true`); `check_bundle_budget.mjs` on a fresh production
  build: shared 103 kB, max route 106 kB (`/`), 43 routes, within budget.
- Dependency audit: `pnpm audit` reports 1 advisory (high, braces 3.0.3
  via the Next.js lint chain, no upstream patch, accepted risk with
  revisit trigger — unchanged posture from prior records).
- Search baseline: `bench_search.mjs` postgres-fts p95 ~5.9–15.6 ms on
  200 synthetic records (environment-relative, PGlite).
- Board/changes baseline: `bench_board_changes.mjs` list_flows p95
  ~44.1 ms, get_flow_steps ~1.6 ms, get_changes ~46.3 ms, find_similar
  ~5.0 ms (environment-relative, PGlite).
- Concurrent load: `bench_concurrent.mjs` 50/50 requests succeed with
  results under 10-way parallelism (p50 70.7 ms, p95 104.9 ms,
  environment-relative, PGlite).
- Worker health: ok (`noModel:true`, `egress:deny-unapproved`), including
  under `SKELET_NO_MODEL=1`.
- Web production build: PASS (privacy/terms/support prerendered).
  `smoke-web.mjs`: SMOKE_OK. `prove_starter_consumer.mjs`:
  STARTER_CONSUMER_OK (9 files, placeholders yes, canary absent).
  `prove_registry_install.mjs`: REGISTRY_INSTALL_PROOF_OK
  (skelet-button, skelet-card).
- Graft: `build` + `check` green.

## Verdict

Zero failures across the full sweep on the release candidate. This record
ends with the same honest limitations as prior qualifications: benches
are PGlite-relative (not production SLOs); live rrweb capture,
embeddings, watch/scoring, Apps views, hosted storage/dashboards, and
production-scale ops remain authorized deferrals per the matrix; test
signatures prove the signing procedure, not a production release
identity. Not a standalone release declaration.
