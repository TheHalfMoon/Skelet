# AF-12(i) PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.80, correctness 0.62, evidence 0.46, reliability 0.86, scope 0.44, security 0.80 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: assets lint clean (0 warnings after fix) + 13/13 brandfont-area tests PASS; full sweep values recorded in `docs/qualification/AF-12_RELEASE_QUALIFICATION.md` (170 python, 107 core, 197 lens, 99 db non-PG, 14 PG, 48 adapters, build/smoke/starter/registry proofs OK); Graft `build` + `check .` green locally; CI will re-verify at exact head.

## Correctness — PASS

- The removed line was an unused `eslint-disable-next-line no-control-regex`: the rule reports no problem on the `/[<>&\0-\x1F\x7F]/` guard, so the directive was dead. The guard itself is untouched and still rejects control characters with the same error. Brandfont tests pass. The qualification doc reports measured values only and explicitly defers P00–P15/R0–R7 and Issue #62. Zero must-fix.

## Parsimony — PASS

- One comment-line deletion plus one evidence doc plus Jev spec/review docs. No runtime, schema, API, MCP, migration, or donor change. Smallest coherent hygiene step. Zero must-fix.

## Product — PASS

- Completes AF-12(i): lint is warning-free and the release sweep is committed as inspectable evidence. No product behavior changes; no launch-scope claims beyond what was measured. Follow-on grains own the matrix reconciliation and Issue #62. Zero must-fix.

## Security — PASS

- The input guard is byte-identical; no new input surface, secret, egress, network, or permission change. The doc makes no upstream-compatibility claim. Zero must-fix.
