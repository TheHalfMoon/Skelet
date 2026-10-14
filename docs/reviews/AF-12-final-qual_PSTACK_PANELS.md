# AF-12 Final Qualification PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.60, correctness 0.31, evidence 0.35, reliability 0.38, scope 0.23, security 0.17 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: full sweep rerun on base `8027264` with zero failures (see the qualification record for the per-suite breakdown); graft `build` + `check` green; python 182/182; hygiene PASS.

## Correctness — PASS

- Every recorded count transcribed from a real local run on the candidate; method caveats (subgroups, fresh DBs, environment-relative bench) stated in the record. Zero must-fix.

## Parsimony — PASS

- One record plus one delta line plus review records. No product change, no new surfaces. Zero must-fix.

## Product — PASS

- Gives the release candidate a complete, honestly bounded qualification record that the matrix and Issue #62 disposition can reference. Zero must-fix.

## Security — PASS

- No failure hidden, no advisory downgraded, stale-database caveat stated, scratch-only fixture DB use. Zero must-fix.
