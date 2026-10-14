# AF-12 Final Release Qualification — 2026-10-14 (main `8027264`)

Branch: `skelet/af12-final-qual`. Base: `8027264` (PR #101 merge, CI `38605237121` SUCCESS 15/15).
Scope of this grain: rerun the full measured qualification sweep on the
release candidate that includes the operations drill (PR #100) and the
unified release evidence (PR #101). No product code changed in this grain;
any defect found would have become its own fix grain. Full P00–P15 / R0–R7
reconciliation lives in `AF-12_ACCEPTANCE_MATRIX.md` (with post-audit
deltas through PR #101); Issue #62 stays open for AC-01/AC-02 adopt-vs-keep
decisions and AC-04 deferrals.

## Measured sweep (real execution on the Mac, 2026-10-14, base `8027264`)

- Frozen install: `pnpm install --frozen-lockfile` clean ("Already up to date").
- Lint: all 11 workspaces PASS, zero warnings (`apps/web`, `apps/worker`,
  `packages/assets`, `packages/db`, `packages/editor-adapters`,
  `packages/ingest`, `packages/lens`, `packages/no-model`,
  `packages/providers`, `packages/sdk-ts`, `packages/storage`).
- Typecheck: all 11 workspaces PASS.
- Python: `python3 -m unittest discover -s tests` — 182/182 OK (includes
  4 SBOM conformance tests).
- Node web/worker (subgroup runs, one process per group): 99 web + 15
  worker = 114/114. (A single-process run of all three globs together was
  not used; subgroups are the recorded evidence.)
- Assets: 33/33. Ingest: 14/14 (includes 6 corpus importer tests).
- Providers + SDK-TS + storage + no-model: 39/39.
- Editor adapters (vector + raster, incl. genuine-argv regressions): 50/50.
- Lens (incl. real Chromium capture): 197/197.
- DB non-PG (12 files, incl. backup-restore 2/2 and rehearsal 1/1): 116/116.
- Real PostgreSQL (fresh fixture database per suite): pg-integration 2/2,
  pg-graph 2/2, pg-workflows 5/5, pg-build-kit 5/5, pg-backup-restore 1/1
  (15/15). Suites share one database in the committed CI job order; a
  combined single-process run against a stale database is not valid
  evidence and was not used.
- Validators: `check_no_model` PASS (strict, 26 hosts), `validate_upstreams`
  PASS (38 sources), `validate_build_kit` PASS, `validate_agent_contract`
  PASS, `validate_registry` PASS (2 items), `validate_skills` PASS
  (4 skills), `generate_sbom.py --check` PASS (380 components),
  `ci_hygiene.py` PASS (652 tracked files).
- Dependency audit: `pnpm audit --json` reports 1 advisory (high, braces
  3.0.3, no upstream patch, dev-only lint chain, accepted risk with
  revisit trigger); 4 postcss advisories closed by the 8.5.30 override.
  See `DEPENDENCY_SCAN.md`.
- Search baseline: `bench_search.mjs` p50 6.61 ms / p95 10.1 ms /
  max 15.76 ms (environment-relative, PGlite).
- Worker health: ok (`noModel:true`, `egress:deny-unapproved`), including
  under `SKELET_NO_MODEL=1`.
- Web production build: PASS (Next.js 15.5.27, postcss 8.5.30).
  `smoke-web.mjs`: SMOKE_OK. `prove_starter_consumer.mjs`:
  STARTER_CONSUMER_OK (9 files, placeholders yes, canary absent).
  `prove_registry_install.mjs`: REGISTRY_INSTALL_PROOF_OK
  (`skelet-button`, `skelet-card`).
- Graft: `graft build` (1913 nodes) + `graft check` green locally.

## Honest limitations (not verified here)

- VectorCraft/PhotoCraft genuine-binary qualifications stand as recorded
  (`VECTORCRAFT_BINARY_QUALIFICATION.md`,
  `PHOTOCRAFT_BINARY_QUALIFICATION.md`); fixture suites remain the CI story.
- Production R2/S3 at scale, hosted Postgres at scale, enterprise
  SSO/SCIM, GPU paths: not exercised; explicitly out of scope for the
  zero-founder-spend local core.
- P13 `get_changes`, AC-01/AC-02 adopt-vs-keep measurements, AC-04
  post-launch evaluations: deferred by design, tracked in the matrix and
  Issue #62, never counted complete.

## Release verdict for this grain

The release candidate at `8027264` reproduces the full green sweep with
zero failures across every executed suite. No defect was found; no product
change was needed. This record plus the matrix (with deltas) is the
qualification evidence for the candidate. P15/R7 close fully only with the
matrix reconciliation and Issue #62 disposition they reference.
