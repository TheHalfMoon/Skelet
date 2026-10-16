# AC-00 Bundle Baseline — Measured Client-Bundle Rollback Criterion (2026-10-16)

Status: BASELINE RECORD with machine-checked parser tests. Base: `b5e9fd9` (PR #135 merge).
Scope: closes the Issue #62 global-gate-4 bundle-size gap with a measured,
enforced rollback criterion. No product code changed by this grain beyond
the check script itself (no route, component, or dependency change).

## Measured baseline (Mac release candidate, 2026-10-16)

Production build `pnpm --dir apps/web build`, parsed by
`scripts/check_bundle_budget.mjs`:

- Shared First Load JS: 103 kB (chunks 46.6 + 54.2 + 1.87 kB).
- Heaviest route: `/` at 106 kB; pages `/boards` 106, `/flows` 105,
  `/gallery` 105, `/lens` 106, `/patterns` 105 kB.
- Route count: 40 (pages plus API routes at 103–104 kB shared-dominated).

## Enforced budgets

- Shared First Load JS ≤ 120 kB.
- Max route First Load JS ≤ 140 kB.

Budgets carry headroom for CI-platform variance, not a growth allowance:
any breach fails the `web` CI job and must be justified (recorded here)
or fixed (smaller dependency, dynamic import, route split) before merge.

## How it runs

- Local/operator: `pnpm --dir apps/web build 2>&1 | tee /tmp/build.log`
  then `node scripts/check_bundle_budget.mjs --build-output /tmp/build.log`
  (exit 0 within budget, 1 over budget, 2 invalid input).
- CI (`web` job): the existing production-build step pipes its output to
  the check script; no second build is run.
- Offline parser proof: `tests/node/bundle-budget.test.mjs` (4 tests on a
  frozen build-table sample, breach naming, fail-closed parsing).

## Limits (honest)

- First Load JS is the download/parse baseline, not a Core Web Vitals or
  interaction-latency claim; LCP/INP/CLS need device-lab measurement that
  this record does not provide.
- Numbers are toolchain-relative (Next 15.5.27, Node 22); a toolchain
  upgrade may move every number and must re-baseline here with the same
  procedure, not by widening budgets silently.
