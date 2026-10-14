# AF-12(i) Release Qualification Evidence — 2026-10-14

Branch: `skelet/af12-release-qualification`. Base: `73c67f8` (AF-11 merge).
Scope of this grain: release hygiene (one unused lint directive) plus a
committed measured qualification record. Full P00–P15 / R0–R7
reconciliation and Issue #62 closeout remain follow-on grains; nothing here
claims them.

## Fix in this grain

- `packages/assets/src/brandfont.ts`: removed the unused
  `// eslint-disable-next-line no-control-regex` above `rejectControls`.
  The directive fired `0 errors and 1 warning` under the pinned toolchain
  (Node v26.0.0, pnpm 9.12.0, eslint 9.x). Behavior is unchanged: the
  `/[<>&\0-\x1F\x7F]/` guard still rejects control characters, and the
  brandfont suite (13 tests across assets/iconset/brandfont files) passes.
  Regression gate: `pnpm --dir packages/assets lint` must report zero
  warnings, and the brandfont tests must pass.

## Measured sweep (real execution on the Mac, 2026-10-14)

- Frozen install: `pnpm install --frozen-lockfile` clean, lockfile up to date.
- Lint: all 11 workspaces PASS (`apps/web`, `apps/worker`, `packages/assets`
  [1 warning before this fix, 0 after], `packages/db`,
  `packages/editor-adapters`, `packages/ingest`, `packages/lens`,
  `packages/no-model`, `packages/providers`, `packages/sdk-ts`,
  `packages/storage`).
- Typecheck: all 11 workspaces PASS.
- Python: `python3 -m unittest discover -s tests` — 170/170 OK.
- Node core (`tests/node` + `apps/web/tests` + `apps/worker/tests`): 107/107.
- Assets (assets/iconset/brandfont): 13/13.
- Ingest publish: 8/8.
- Providers + SDK-TS + storage + no-model: 39/39.
- Editor adapters (vector + raster): 48/48.
- Lens (20 files incl. real Chromium capture): 197/197.
- Worker alone: 15/15. DB non-PG (9 files): 99/99.
- Monet screenshot queue: 6/6. Storage alone: 11/11.
- Real PostgreSQL (`skelet_test`, password `local_ci_fixture_only`):
  pg-integration 2/2, pg-graph 2/2, pg-workflows 5/5, pg-build-kit 5/5.
  (One expected-error log line about dependent objects is part of a passing
  rollback test, not a failure.)
- Validators: `check_no_model` PASS (strict, 26 hosts), `validate_upstreams`
  PASS (38 sources), `validate_build_kit` PASS, `validate_agent_contract`
  PASS, `validate_registry` PASS (2 items), `validate_skills` PASS (4 skills).
- Worker health: ok (`noModel:true`, `egress:deny-unapproved`), including
  under `SKELET_NO_MODEL=1`.
- Web production build: PASS (Next.js 15.5.27). `smoke-web.mjs`: SMOKE_OK.
  `prove_starter_consumer.mjs`: STARTER_CONSUMER_OK (9 files, placeholders
  yes, canary absent). `prove_registry_install.mjs`:
  REGISTRY_INSTALL_PROOF_OK (`skelet-button`, `skelet-card`).
- Graft: `graft build` (1772 nodes, 5085 edges, 191 cards) + `graft check`
  green locally.

## Honest limitations (not verified here)

- Genuine upstream PhotoCraft/VectorCraft binary execution: still
  UNVERIFIED (fixture-only adapters). No claim otherwise.
- Production R2/S3, hosted Postgres at scale, enterprise SSO/SCIM, GPU
  paths: not exercised in this grain; covered by later AF-12 grains.
- P00–P15 / R0–R7 matrix: not reconciled here.

## Release verdict for this grain

No blocking defect found beyond the fixed lint warning. The system state
above is reproducible from a clean checkout with the pinned toolchain.
AF-12 qualification continues in follow-on grains.
