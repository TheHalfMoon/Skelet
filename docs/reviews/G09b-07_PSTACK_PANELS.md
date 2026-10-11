# G09b-07 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context read-only sessions over the starter
synthesizer, its 10-test suite, and the one-line CI addition.
Specialized agent providers unavailable: the judges used inline bars,
not four independent provider models. This record MUST NOT be
described as four independent provider models.

Review basis: base `885079e…` through the working tree. Targeted runs:
lens starter-synthesis 10/10, full lens 176/176, lens typecheck +
ESLint clean.

## Must-fix (one test-design defect found and closed pre-commit)

- **M1 — no-copy test proved the wrong property.**
  The first draft fed distinctive text as a section *tag* (which the
  starter legitimately references, escaped) and asserted its absence.
  Restructured honestly: the request accepts an optional `text` field
  that is validated but never emitted, and the test proves a
  distinctive `text` value appears in no starter file while the tag
  still renders as an escaped placeholder.

## Evidence-signal triage (closed pre-commit)

- First Jev pass: evidence 0.75 with no demonstrated defect. Triage
  added the remaining validation-branch tests (oversized text,
  non-object sections, float/NaN counts, theme-sibling reference,
  500-section acceptance with 12-section cap). Second pass: evidence
  0.47.

## Worth considering (one accepted advisory)

- **A1 — Jev scores are probabilistic, not verdicts.**
  Post-repair band sits at previously merged levels; branch-by-branch
  review shows no open defect and every branch is covered by a
  committed test. ACCEPTED with the triage recorded here.

## Four-bar verdicts

- **Correctness: PASS** — fixed four-file set with byte counts;
  synthesis headers on prose files; pinned dependency defaults that
  parse; honest token/coverage notes; 12-section cap with explicit
  omission accounting; empty-state stub; byte-identical rebuilds.
- **Parsimony: PASS** — one pure module, one test file, one CI line;
  no theme generation, token extraction, network, storage, or public
  API.
- **Product: PASS** — placeholder starter with synthesis labeling and
  stubs for unknown behavior, exactly the G09b-07 slice; kit wiring
  (documents into manifest plus ZIP) stays in its own grain.
- **Security: PASS** — tags HTML-escaped; site text never emitted;
  fixed `starter/` paths only (no traversal surface); unknown fields
  rejected; no secret material.

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.
