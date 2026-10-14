# AF-12 Release Hardening Evidence — 2026-10-14

Branch: `skelet/af12-release-hardening`. Base: `a681873` (PR #99 merge).
Scope of this grain: release-hardening artifacts only (SBOM, audit
posture, migration rehearsal, SLO documentation, load baseline, matrix
delta). No product behavior change. Final release qualification stays a
separate follow-on grain that re-runs the full measured sweep on the
release candidate.

## SBOM

- Generator: `scripts/generate_sbom.py` (stdlib only, offline) over the
  committed `pnpm-lock.yaml` (v9) and `requirements-ci.txt` pins.
- Output: committed root `sbom.json`, CycloneDX 1.5 minimal, deterministic
  sorted components with `pkg:npm` / `pkg:pypi` purls.
- Content at generation: 380 components (379 npm + 1 PyPI), including
  pinned `next@15.5.27`, `react@19.3.0`, `pg@8.23.1`,
  `typescript@5.9.3`, and the remediated `postcss@8.5.30` (see audit).
- Conformance: `tests/test_sbom.py` (4 tests, offline) asserts the
  envelope, sorting/uniqueness, purl shape, pinned-toolchain presence,
  and requirements coverage. Regenerate on dependency changes; freshness
  is enforced by `generate_sbom.py --check`.

## Dependency audit posture (2026-10-14, after remediation)

- Before: `pnpm audit --json` reported 5 advisories (2 moderate, 3 high,
  0 critical): four transitive `postcss@8.4.31` findings plus one
  `braces@3.0.3` finding, all via `next@15.5.27`.
- Fix in this grain: root `package.json` pnpm override pins `postcss`
  to `8.5.30` (exact; same-major, inside Next's `^8` range), closing all
  four postcss advisories. Verified by post-change audit, green
  production build, and exact-head CI. Full record:
  `docs/qualification/DEPENDENCY_SCAN.md`.
- After: 1 advisory remains, GHSA-vfj7-8cjw-p6xm (high, braces 3.0.3,
  CVE-2026-93687) with no upstream patch published. Disposition:
  accepted risk — dev-only lint-time chain, inputs are developer-owned
  config (never network input), revisit on any upstream patch or
  request-path move. Documented, not suppressed.
- Python CI dependencies install with `--require-hashes --no-deps
  --only-binary` (see the `bootstrap` job); pins plus hashes are the
  enforcement, re-verified on every head.
- Secret posture: no ambient credentials in workers (proven by the
  capture secret-free-env tests and the no-model gate); redaction is
  contract-tested in agent envelopes.

## Migration rehearsal (real PostgreSQL 17, scratch database)

- Full cycle on an empty `skelet_rehearse` database (dropped after):
  `migrateUp` applied 16 migrations ending at `016_corpus_flow_import`,
  `migrateDown` rolled back 16 starting at `016_corpus_flow_import`,
  second `migrateUp` re-applied 16. Zero errors.
- The `016` down file restores the exact prior CHECK and function body;
  the graph rollback test proves down/up on PGlite in CI.

## Load baseline

- `bench_search.mjs` (200 synthetic records, 100 iterations, PGlite):
  `arrow` p50 9.73 ms / p95 10.49 ms / max 11.16 ms without facets,
  p50 15.87 ms with facets. Two orders of magnitude inside the 500 ms
  search target on constrained hardware; environment-relative, not a
  production SLO (see `docs/operations/SLOS.md`).
- MCP read-tool and Lens completion timing under production-like load
  remain final-qualification work, not claims made here.

## Honest limitations (not verified here)

- No hosted load test, no production R2/S3 exercise, no enterprise
  SSO/SCIM, no GPU paths.
- P00–P15 / R0–R7 final reconciliation and the P15 commercial
  checklist close in the final qualification grain, not here.
