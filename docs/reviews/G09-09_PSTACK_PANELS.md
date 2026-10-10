# G09-09 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context independent subagent sessions, read-only.
Specialized agent providers unavailable: the judges used inline bars, not
four independent provider models.

## Initial fresh-context panel

Review basis: base `19ed118…` through the working tree, including the new
style-evidence module, capture/report wiring, new tests, and the CI delta.
No files were edited by the reviewer. Targeted tests were executed
read-only (style-evidence 8/8, report-assembly 15/15 at that time).

## Must-fix

None. No correctness, parsimony, product, or security bar was violated
with a concrete exploit or failure case.

## Worth considering (all seven addressed or accepted)

- **A1 — Dead `elementRef`.** The pure builder was exported but only tests
  used it; capture built flat refs inline. FIXED structurally: the page now
  returns ancestor segments and Node projects them via
  `projectPathSnapshots`/`elementRef`, so refs are genuine `html > body >
  …` paths and no dead export remains.
- **A2 — Redundant `allowed` set.** The loop already iterated the
  allowlist, making the membership check unreachable. FIXED by removal.
- **A3 — Hardcoded property cap.** The worker used literal `256`. FIXED by
  importing `TOKEN_LIMITS.maxPropertyChars` from the extractor contract.
- **A4 — Empty-value leniency.** The validator accepted `value: ""`
  although the pipeline never emits empties. FIXED by requiring non-empty
  values for fail-closed parity.
- **A5 — Required-field migration.** Pre-change persisted captures without
  `declarations` are now invalid even for the caller-supplied path.
  ACCEPTED: `CaptureResult` is transient IPC with no external constructors
  (verified by search); all in-repo fixtures migrated.
- **A6 — Silent value truncation.** In-page clipping to 512 chars was
  unrecorded. FIXED: the page reports `styleTruncated` (closure-local
  length comparison, not page-controlled) and the result carries an
  explicit `style-values-truncated` coverage gap.
- **A7 — `observed` understates.** Capture-path provenance did not name
  computed styles. FIXED: capture reports observe
  `["source","title","sections","screenshot","asset-links","computed-styles"]`.

## Four-bar verdicts

- **Correctness: PASS** — 43/43 allowlist match, coherent budgets
  (32 x 43 = 1,376 <= 1,500), complete-report identity binding preserved.
- **Parsimony: PASS** — one pure module, one IPC field, one validator,
  one shared assembly entry; no duplicated logic.
- **Product: PASS** — no misleading-evidence path; caller path unchanged;
  rights remain unknown/non-downloadable; partial status preserved.
- **Security: PASS** — offline render untouched, bounded/clipped DATA-only
  values, DTCG export gates intact, sparse-array and budget bypasses closed.

Verification: new tests passed, typecheck, lint, and `git diff --check`
passed at review time; findings are advisories, not defects.

## Delta (advisory closures)

A second fresh-context session verified A1–A4 and A6–A7 FIXED without
new defects, and A5 accepted as documented:

- Path refs deterministic (document order, closest-6 chain, ASCII tags,
  sibling indexes) and bounded (depth <= 6, tag <= 16, index <= 9999,
  ref <= 256); body-less documents cannot crash the walk.
- No second style allowlist remains; extractor sets are the contract, not
  a duplicate.
- No import cycle from the `TOKEN_LIMITS` import; capture budgets stay
  strictly tighter than extractor budgets.
- Empty-value rejection cannot false-reject honest evidence (the pipeline
  never emits empties).
- The truncation flag is spoof-proof (closure-local length comparison;
  scripts disabled, structured-clone output type-gated).
- The 4-element coverage-gap superset passes the required-markers check;
  `observed`/`deterministic` are server-side constants, never
  page-controlled.

Two micro-notes were also closed: `projectPathSnapshots` now iterates by
index so holey input fails closed at that layer (with a regression test),
and the review record test count was synchronized to 10.

## Four bars

- Correctness: **PASS**
- Parsimony: **PASS**
- Product: **PASS**
- Security: **PASS**

Remaining must-fix: **None.**

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.

panel: full — correctness ✓ inline · parsimony ✓ inline · product ✓ inline · security ✓ inline · deltas: mechanical tier
