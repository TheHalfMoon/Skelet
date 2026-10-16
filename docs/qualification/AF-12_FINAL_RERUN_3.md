# AF-12 Final Qualification Rerun 3 — 2026-10-16 (main `aca627b`)

Branch: `skelet/af12-final-rerun-3`. Base: `aca627b` (PR #134 merge, CI SUCCESS 15/15).
Scope of this grain: rerun the full measured qualification sweep on the
release candidate that includes PRs #132–#134 (genuine OpenPencil binary
qualification, P10 capture disposition, P15-2 operator alarm CLI). No
product code changed in this grain; any defect found would have become
its own fix grain. Full P00–P15 / R0–R7 reconciliation lives in
`AF-12_ACCEPTANCE_MATRIX.md` (with post-audit deltas through PR #134);
Issue #62 stays open for the remaining AC-00/AC-03 proofs and
AC-01/AC-02/AC-04 recorded decisions.

## Measured sweep (real execution on the Mac, 2026-10-16, base `aca627b`)

- Frozen install: `pnpm install --frozen-lockfile` clean.
- Lint: all 11 workspaces PASS, zero warnings (`apps/web`, `apps/worker`,
  `packages/assets`, `packages/db`, `packages/editor-adapters`,
  `packages/ingest`, `packages/lens`, `packages/no-model`,
  `packages/providers`, `packages/sdk-ts`, `packages/storage`).
- Typecheck: all 11 workspaces PASS.
- Python: `python3 -m unittest discover -s tests` — 224/224 OK
  (221 at `96f4536` plus 3 P10 capture-disposition tests).
- Node web/worker (one process for all three globs): 161/161
  (156 at `96f4536` plus 5 P15-2 operator CLI tests).
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
  `ci_hygiene.py` PASS (889 tracked files).
- Dependency audit: `pnpm audit` reports 1 advisory (high, braces 3.0.3
  via the Next.js lint chain, no upstream patch, accepted risk with
  revisit trigger — unchanged posture from the `96f4536` record).
- Search baseline: `bench_search.mjs` postgres-fts p95 ~3.6–5.7 ms on
  200 synthetic records (environment-relative, PGlite).
- Board/changes baseline: `bench_board_changes.mjs` list_flows p95
  ~12.3 ms, get_flow_steps p95 ~0.5 ms (environment-relative, PGlite).
- Worker health: ok (`noModel:true`, `egress:deny-unapproved`), including
  under `SKELET_NO_MODEL=1`.
- Web production build: PASS. `smoke-web.mjs`: SMOKE_OK.
  `prove_starter_consumer.mjs`: STARTER_CONSUMER_OK (9 files,
  placeholders yes, canary absent). `prove_registry_install.mjs`:
  REGISTRY_INSTALL_PROOF_OK (skelet-button, skelet-card).
- Graft: `build` + `check` green.

## Verdict

Zero failures across the full sweep on the release candidate. This record
ends with the same honest limitations as the `96f4536` qualification:
benches are PGlite-relative (not production SLOs); live rrweb capture,
embeddings, watch/scoring, Apps views, and prod-scale ops remain authorized
deferrals per the matrix. The genuine OpenPencil binary gap is closed by
the separate `OPENPENCIL_BINARY_QUALIFICATION.md` record (genuine-binary
proof lives there, not in the fixture suite). Not a standalone release
declaration.
