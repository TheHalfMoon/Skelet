# AF-12 Release Evidence (Unified) Jev Review Summary

- Spec: `docs/reviews/AF-12-release_JEV_SPEC.json` (base `017639e`, head worktree at review time, six noul questions).
- Review: `docs/reviews/AF-12-release_JEV_REVIEW.json`, genuine `jev ask` run, model `jev-1.13.0`, `ok: true`.
- CLI: genuine Jev v2026.919.0 (`jev --version`).
- Scores: compatibility 0.56, correctness 0.20, evidence 0.39, reliability 0.52, scope 0.20, security 0.48.
- No blocking finding. Scores are estimated probabilities of a material issue under the noul criteria (true = material issue exists). Compatibility/reliability are the highest dimensions (transitive-override risk), mitigated by the green production build plus lint/typecheck plus exact-head CI; recorded, not dismissed. This summary MUST NOT be presented as anything other than a genuine Jev CLI evaluation of the stated spec.
