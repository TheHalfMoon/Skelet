# AC-00 Perf Baseline PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.64, correctness 0.5, evidence 0.16, reliability 0.49, scope 0.13, security 0.18 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`). The correctness score produced a real edge-case fix (versions clamp); the rest is dispositioned in the review summary.
- Suites: node bench-proof test green, web/node/worker green, python untouched and green, hygiene PASS, Graft `build` + `check` green locally; PGlite fixture per run.

## Correctness — PASS

- Fixed corpus with deterministic titles, actor-scoped reads on the exact transport functions, warm-up before sampling, p50/p95/max with result sizes proving non-empty coverage of all four ops, full-size baseline recorded environment-relative. Zero must-fix.

## Parsimony — PASS

- One bench script, one CI schema test auto-wired into the existing node glob. No gates, no product change, no alert/monitoring implementation, no unrelated refactors. Zero must-fix.

## Product — PASS

- Establishes the AC-00 perf-baseline leg (board-adjacent reads; rollback criterion now measurable against these numbers). SLOs/alerts stay a P15 follow-on and are not claimed. Zero must-fix.

## Security — PASS

- Synthetic fixture only, no secrets, no network, owner actor, no shell beyond the test's own node spawn. Zero must-fix.
