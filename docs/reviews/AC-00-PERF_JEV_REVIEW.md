# AC-00 Perf Baseline Jev Review Summary

- Spec: `docs/reviews/AC-00-PERF_JEV_SPEC.json` (base `e636adb`, head `WORKTREE` at review time, six noul questions).
- Review: `docs/reviews/AC-00-PERF_JEV_REVIEW.json`, genuine `jev ask` run, model `jev-1.13.0`, `ok: true`.
- CLI: genuine Jev v2026.919.0 (`jev --version`).
- Scores: compatibility 0.64, correctness 0.5, evidence 0.16, reliability 0.49, scope 0.13, security 0.18.
- Disposition: no blocking finding. The correctness score was answered
  with a real fix during review: single-version CLI inputs would have
  broken the diff op, so versions clamp to a minimum of 2 with the
  dataset descriptor reporting the clamped shape honestly. The residual
  mass is the standing model view on benchmark grains; numbers are
  recorded as environment-relative and never gated. This summary MUST
  NOT be presented as anything other than a genuine Jev CLI evaluation
  of the stated spec.
