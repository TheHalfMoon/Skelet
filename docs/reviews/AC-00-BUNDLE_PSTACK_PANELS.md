# AC-00 Bundle Baseline PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.53, correctness 0.46, evidence 0.48, reliability 0.60, scope 0.18, security 0.17 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`). Scores dispositioned in the review summary (new-surface uncertainty, not a changed contract).
- Suites: bundle-budget 4/4; real-build check exits 0 with shared 103 / max 106 kB; graft `build` + `check` green locally.

## Correctness — PASS

- Parsed 103/106 kB match the real local production build; budgets 120/140 kB carry the stated CI-variance headroom; B/kB/MB parsing, breach naming, and fail-closed behavior are proven by the offline tests. Zero must-fix.

## Parsimony — PASS

- One script, one test module, one baseline doc, two CI lines, one matrix delta line, three review records. No route, component, dependency, schema, API, MCP, migration, donor import, UI, or billing change. Zero must-fix.

## Product — PASS

- Gives Issue #62 global gate 4 its missing bundle rollback criterion (latency baselines already existed via bench scripts); Web Vitals lab work stays honestly out of scope. Zero must-fix.

## Security — PASS

- No network/model/hosted surface; local build-log read with byte budgets; no secrets in doc/tests/CI. Zero must-fix.
