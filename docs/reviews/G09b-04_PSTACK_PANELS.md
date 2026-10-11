# G09b-04 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context read-only sessions over the traversal
executor, its 13-test suite, and the one-line CI addition.
Specialized agent providers unavailable: the judges used inline bars,
not four independent provider models. This record MUST NOT be
described as four independent provider models.

Review basis: base `5093e5c…` through the working tree. Targeted runs:
lens capture-traversal 13/13, full lens 137/137 pending CI, lens
typecheck + ESLint clean.

## Must-fix (one found and closed pre-commit)

- **M1 — dead `capture/budget` failure code.**
  The first draft declared `capture/budget` in the failure-code union
  but no path ever emitted it (exhaustion is reported as
  `capture/skipped`). Removed from the union and documented the
  trust boundary instead: the injected fetch honors per-page slices,
  traversal enforces inventory totals. Found during Jev evidence-signal
  triage (first Jev pass: evidence 0.77), fixed structurally with a
  dedicated over-slice honesty test.

## Worth considering (two accepted advisories)

- **A1 — all-skipped maps to `failed`.**
  When budgets exhaust before any attempt (only reachable with a
  jumping clock, since validation requires budgets >= 1), the outcome
  is `failed` with every page recorded as `skipped`. ACCEPTED: no page
  content exists, so success is correctly withheld, and the skip
  records explain why.
- **A2 — Jev correctness 0.29 after repair (was 0.16 pre-repair).**
  Probabilistic score, not a demonstrated defect; branch-by-branch
  review of the executor (sequential order, totals gate, failure
  mapping, fail-closed validation, clock-skew guard) shows no open
  defect, and every branch is covered by a committed test. ACCEPTED
  with the Jev evidence-signal triage recorded here.

## Four-bar verdicts

- **Correctness: PASS** — inventory-order sequential attempts; per-page
  slices passed through; totals gate skips (never silently drops) the
  rest; typed codes preserved, untyped mapped to capture/network,
  malformed fetch records fail the page; completed/partial/failed
  mapping exact; maxDepth 0 accepted per scope bounds.
- **Parsimony: PASS** — one pure module reusing the G09b-03 inventory
  type, one test file reusing `resolveCaptureScope` for genuine
  fixtures, one CI line; no network, browser, storage, retries, or
  public API.
- **Product: PASS** — bounded execution plus deterministic per-page
  inventory with missing-page and partial-coverage reporting, exactly
  the G09b-04 execution slice; transport wiring stays in its own grain.
- **Security: PASS** — no fetch outside the injected function (no SSRF
  surface in-module); scope-hash binding; fail-closed inventories;
  bounded 500-char details; no secret material.

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.
