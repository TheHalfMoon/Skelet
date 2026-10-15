# AF-12 Final Qualification Rerun — 2026-10-15 (main `96f4536`)

Branch: `skelet/af12-final-rerun-2`. Base: `96f4536` (PR #130 merge, CI `38728123860` SUCCESS 15/15).
Scope of this grain: rerun the full measured qualification sweep on the
release candidate that includes PRs #121–#130 (OpenPencil adapter, gallery
UI, flow player, taxonomy reads + UI, replay ledger + transport + playback,
matrix reconciliation, abuse alarms). No product code changed in this
grain; any defect found would have become its own fix grain. Full P00–P15 /
R0–R7 reconciliation lives in `AF-12_ACCEPTANCE_MATRIX.md` (with post-audit
deltas through PR #130); Issue #62 stays open for the remaining
AC-00/AC-03 proofs and AC-01/AC-02/AC-04 recorded decisions.

## Measured sweep (real execution on the Mac, 2026-10-15, base `96f4536`)

- Frozen install: `pnpm install --frozen-lockfile` clean.
- Lint: all 11 workspaces PASS, zero warnings (`apps/web`, `apps/worker`,
  `packages/assets`, `packages/db`, `packages/editor-adapters`,
  `packages/ingest`, `packages/lens`, `packages/no-model`,
  `packages/providers`, `packages/sdk-ts`, `packages/storage`).
- Typecheck: all 11 workspaces PASS.
- Python: `python3 -m unittest discover -s tests` — 221/221 OK.
- Node web/worker (one process for all three globs): 156/156
  (114 at `8027264` plus gallery/flow/pattern/replay/abuse coverage).
- Assets: 35/35. Ingest: 14/14.
- Providers + SDK-TS + storage + no-model: 39/39.
- Editor adapters (vector + raster + openpencil): 70 tests, 69 pass, 1
  labeled genuine-binary skip (`SKELET_OPENPENCIL_BIN` absent), 0 fail.
- Lens (incl. real Chromium capture): 197/197.
- DB non-PG (17 files, incl. gallery/patterns/replay, backup-restore,
  rehearsal): 146/146.
- Real PostgreSQL (local fixture database, CI-identical credentials):
  pg-integration 2/2, pg-graph 2/2, pg-workflows 5/5, pg-build-kit 5/5,
  pg-backup-restore 1/1 (15/15, each suite in its own process).
- Validators: `check_no_model` PASS (strict, 26 hosts), `validate_upstreams`
  PASS (38 sources), `validate_build_kit` PASS, `validate_agent_contract`
  PASS, `validate_registry` PASS (2 items), `validate_skills` PASS
  (4 skills), `generate_sbom.py --check` PASS (380 components),
  `ci_hygiene.py` PASS (863 tracked files).
- Dependency audit: `pnpm audit` reports 1 advisory (high, braces 3.0.3
  via the Next.js lint chain, no upstream patch, accepted risk with
  revisit trigger — unchanged posture from the `8027264` record).
- Search baseline: `bench_search.mjs` p50 5.59 ms / p95 5.99 ms /
  max 6.14 ms (environment-relative, PGlite).
- Board/changes baseline: `bench_board_changes.mjs` p50 3.94 ms /
  p95 4.35 ms / max 4.38 ms (environment-relative, PGlite).
- Worker health: ok (`noModel:true`, `egress:deny-unapproved`), including
  under `SKELET_NO_MODEL=1`.
- Web production build: PASS. `smoke-web.mjs`: SMOKE_OK.
  `prove_starter_consumer.mjs`: STARTER_CONSUMER_OK (9 files,
  placeholders yes, canary absent). `prove_registry_install.mjs`:
  REGISTRY_INSTALL_PROOF_OK (skelet-button, skelet-card).
- Graft: `build` + `check` green.

## Verdict

Zero failures across the full sweep on the release candidate. This record
ends with the same honest limitations as the `8027264` qualification:
benches are PGlite-relative (not production SLOs); genuine OpenPencil
binary proof awaits an operator binary; live rrweb capture, embeddings,
watch/scoring, Apps views, and prod-scale ops remain authorized
deferrals per the matrix. Not a standalone release declaration.
