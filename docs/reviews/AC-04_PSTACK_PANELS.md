# AC-04 PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.59, correctness 0.35, evidence 0.35, reliability 0.23, scope 0.17, security 0.17 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: python 209/209 (205 prior + 4 new), hygiene PASS, Graft `build` + `check` green locally; no network in CI.

## Correctness — PASS

- All four workspace pins plus the artcraft pin re-verified from the lock file with license agreement; manifest post-launch and rejected sets agree; every candidate resolves to DEFER with a trigger; nothing accepted or launch-blocking. Zero must-fix.

## Parsimony — PASS

- One disposition record, one conformance test file. No adoption, no code change, no unrelated refactors. Triggers are re-evaluation conditions, not approvals. Zero must-fix.

## Product — PASS

- Closes AC-04 (post-launch accept/defer records) with explicit verdicts; Issue #62 now has AC-00 (partial, perf/fixture legs remain), AC-01 (KEEP), AC-02 (KEEP), AC-03 (adapters qualified), AC-04 (DEFER all five) dispositioned. Zero must-fix.

## Security — PASS

- Deferral preserves the segment/weights/checkpoint rights boundaries; no donor code, no network in CI. Zero must-fix.
