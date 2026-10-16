# Clean-Install Proof — Isolated Worktree at `9d73f79` (v1 Local §8)

Status: MEASURED PROOF RECORD. Base: `9d73f79` (PR #143 merge).
Scope: execute the canonical `docs/operations/CLEAN_INSTALL.md` 15-step procedure inside an isolated temporary worktree (`/tmp/skelet-clean-9d73f79`, detached HEAD `9d73f79`, zero carried state: no `node_modules`, no env files, no credentials), then delete the worktree. The canonical working tree was never disturbed. Machine-checked by `tests/test_clean_install_proof.py` (offline).

## Measured execution (Mac, 2026-10-16)

| §8 step | Command / check | Measured result |
|---|---|---|
| 1. OS | `sw_vers -productVersion` | macOS 26.6.2 |
| 2. Toolchain | `node --version`, `pnpm --version`, `psql --version` | v26.0.0 / 9.12.0 / 17.9 (Homebrew). Node is newer than CI's pinned 22.23.1 (skew disclosed; all gates below pass on it; CI 22.23.1 remains authoritative combined proof) |
| 3. PostgreSQL | `pg_isready`, `psql` fixture-DB select | accepting connections; `select 1` → 1 |
| 4. Storage | local filesystem adapter convention | `packages/storage` suite green in RERUN_4 (35/35 assets incl. storage); content-addressed store root lives outside Git |
| 5. Env | no secrets present; `SKELET_NO_MODEL=1` for gate steps | no AI keys, no cloud credentials, no GPU in the worktree |
| 6. Frozen install | `pnpm install --frozen-lockfile` (real, timed) | clean, 2.4 s (321 resolved; global store reuse disclosed — lockfile still enforced, zero downloads) |
| 7. Validators | `validate_upstreams.py`, `validate_skills.py`, `validate_agent_contract.py`, `validate_build_kit.py`, `generate_sbom.py --check`, `ci_hygiene.py --expected-head 9d73f79`, scope suites | UPSTREAMS 38 sources; SKILLS 4; CONTRACT PASS; BUILD_KIT PASS; SBOM 380 components; HYGIENE 954 tracked files; v1-local-scope 8/8 + cloud-backlog 7/7 (15/15 combined) |
| 8. Migrations | `packages/db/tests/migration-rehearsal.test.mjs` (up/down/up, scratch) | pass 1, fail 0 |
| 9. Real PG | 5 suites, each own process, CI-identical fixture credentials | pg-integration 2/2, pg-graph 2/2, pg-workflows 5/5, pg-build-kit 5/5, pg-backup-restore 1/1 (15/15, fail 0) |
| 10. Worker | `pnpm --dir apps/worker start health` (normal + `SKELET_NO_MODEL=1`) | both `{"status":"ok","service":"skelet-worker","version":"0.1.0","noModel":true,"egress":"deny-unapproved"}` |
| 11. No-model gate | `SKELET_NO_MODEL=1 python scripts/check_no_model.py --root .` | `NO_MODEL_GATE_PASSED mode=strict hosts=26` |
| 12a. Web build | `pnpm --dir apps/web build` (fresh, in-worktree) | PASS (static + dynamic routes prerendered) |
| 12b. Smoke | `node scripts/smoke-web.mjs 3103` (health + `/` 200 + shutdown) | `SMOKE_OK {"status":"ok","service":"skelet-web","version":"0.1.0"}` |
| 12c. Starter | `node scripts/prove_starter_consumer.mjs --port=3127` | `STARTER_CONSUMER_OK files=9 placeholders=yes canary=absent` |
| 12d. Registry | `node scripts/prove_registry_install.mjs` | `REGISTRY_INSTALL_PROOF_OK items=skelet-button,skelet-card` |
| 13. Research workflow | `apps/web/tests/golden-journey.test.mjs` (10-stage S0, no mocks on agent paths) | pass 1, fail 0 |
| 14. Agent workflow | `interop-http.test.mjs` + `interop-stdio.test.mjs` (wire clients + SDK envelopes) | pass 11, fail 0 |
| 15. Shutdown/restart | smoke script shutdown + repeated worker health | server exited cleanly; worker health re-run `ok` |
| Release checks | `sign_release_artifact.mjs --self-test` | `verified: true` (ephemeral key, fixture payload — procedure proof, never a release identity) |
| Cleanup | `git worktree remove --force /tmp/skelet-clean-9d73f79` | worktree deleted; canonical tree untouched; `.ignore` preserved |

## Honest boundaries

- Bundle budgets (shared 103 kB / max route 106 kB) are enforced by the exact-head CI `web` job on its own build output (`BUNDLE_BASELINE.md`), not re-measured in this worktree; the in-worktree production build passed.
- Node-batch disclosure from `AF-12_FINAL_RERUN_4.md` stands: an 8 GB Mac runs Node suites in batches; CI runs them combined. This proof ran each listed suite in its own process (fail 0 everywhere).
- Windows: no claim (only the `storage-windows-latest` CI job). Linux: CI ubuntu-24.04 exact-head proof. macOS: this record.
- Zero failures. Any future RC code change requires a fresh pointer run; docs-only deltas do not invalidate this code coverage.
