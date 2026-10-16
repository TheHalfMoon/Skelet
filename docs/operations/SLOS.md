# Skilit Launch SLO Targets and Operator Thresholds

Status: planning targets from `docs/IMPLEMENTATION_PLAN.md` section 17,
with the first measured baseline attached. These are objectives to
benchmark before any hosted offer, not promises about unmanaged hardware.

## Targets (unchanged from the canonical plan)

- Search API p95: < 500 ms for cached/common queries; < 1.5 s for hybrid
  visual/semantic queries.
- MCP read tool p95 excluding heavy analysis jobs: < 1 s.
- Lens submission acknowledgement: < 1 s; heavy analysis is
  asynchronous with job state.
- Lens normal public-page completion target: < 60 s, with provider-level
  partial results instead of total failure when optional analyzers fail.
- Asset metadata/API availability: 99.9% target after production launch.
- Zero cross-workspace data exposure in the authorization test matrix.

## First measured baseline (2026-10-14, Apple Silicon Mac, PGlite)

`node scripts/bench_search.mjs --records 200 --iterations 100`
(synthetic 200-record corpus, lexical FTS only, no embeddings):

- `arrow` without facets: p50 9.73 ms, p95 10.49 ms, max 11.16 ms.
- `arrow` with facets: p50 15.87 ms (p95/max in the committed run output).

PGlite timings are environment-relative and are not production SLOs;
they establish that the lexical path has two orders of magnitude of
headroom on constrained hardware before any optimization is justified.
Re-run on the release candidate before claiming launch readiness.

## Operator alert thresholds (self-hosted)

With no hosted monitoring in the zero-founder-spend modes, operators
configure these from local logs and job tables. The committed evaluator
`apps/web/lib/abuse-alarms.ts` (`evaluateAbuseAlarms`, covered by
`apps/web/tests/abuse-alarms.test.mjs`) operationalizes these exact
thresholds as a pure deterministic function; feed it from the runbook
procedure below. Managed alerting (paged on-call, hosted dashboards) is
explicitly deferred until a budgeted hosted offer exists; the evaluator
must never be mistaken for one.

- Any `FORBIDDEN_OR_NOT_FOUND` rate spike across workspaces: investigate
  as a possible confused-deputy or enumeration attempt (never as proof
  of one — the code is identical by design).
- Quota-exhaustion (`QUOTA_EXCEEDED`) bursts from one workspace:
  rate-limit review and credential rotation per the runbook.
- Lens jobs stuck past their time budget: cancel, inspect the capture
  worker logs, and re-verify the no-model gate.
- `pg_dump` age older than the retention policy: backup alarm.
- Store-root growth beyond the provisioned budget: retention/purge review.

Managed alerting (paged on-call, hosted dashboards) is explicitly
deferred until a budgeted hosted offer exists; it must never be assumed
from these documented thresholds.

## Release verification objectives (operator-runnable)

Every objective below is checkable with committed scripts on the
operator's own hardware. Any objective failing twice in a row is an
incident: attribute to an authenticated identity, workspace, and run/job
ID per the runbook, preserve redacted logs, and do not serve traffic on
health, no-model, or backup failure.

| # | Objective | Verify | Breach response |
|---|-----------|--------|-----------------|
| 1 | Clean-checkout frozen install succeeds | `pnpm install --frozen-lockfile` (CI `bootstrap` job) | Block release; diff lockfile vs manifest |
| 2 | Web production build passes and health/smoke pass | `pnpm --dir apps/web build`; `node scripts/smoke-web.mjs 3103` | Block release; inspect build/smoke logs |
| 3 | Worker health passes with no provider secrets | `SKILIT_NO_MODEL=1 pnpm --dir apps/worker start health`; `python3 scripts/check_no_model.py --root .` | Fail closed; audit env for forbidden credentials |
| 4 | Dependency posture holds | `python3 scripts/generate_sbom.py --check`; `pnpm audit --json` (see `DEPENDENCY_SCAN.md`) | Override/update grain for patched advisories; dated accepted-risk entry otherwise |
| 5 | Migrations rehearse up/down/up on scratch hardware | `migration-rehearsal` suite (CI `db-foundation` job) | Block upgrade; fix the down migration first |
| 6 | Backup exists and restore is proven before serving | Runbook drill; `backup-restore` suites | Re-run drill on scratch DB; do not serve until verify passes |
