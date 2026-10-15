# AF-14c Similarity Gate Fix PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.51, correctness 0.55, evidence 0.28, reliability 0.74, scope 0.14, security 0.44 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`). Reliability/correctness dispositioned in the review summary (truncation semantics unchanged; one pre-existing narrowing consciously preserved).
- Suites: similarity 11/11 (10 prior + 1 new gate test), transport similar 5/5 (4 prior + 1 new), assets 27/27, web/node/worker 125/125, python 217/217, lint/typecheck clean on assets plus web, Graft `build` + `check` green locally.

## Correctness — PASS

- Leak reproduced failing before the fix and green after; predicate verified branch-by-branch against the central gate; pre-existing workspace-private and oracle suites still green alongside the new regressions. Zero must-fix.

## Parsimony — PASS

- One WHERE-clause restriction plus two regression tests. No kinds change, no search change, no gate redesign, no unrelated refactors. Zero must-fix.

## Product — PASS

- Closes a real cross-tenant leak class opened by the kinds expansion; find_similar keeps its P11 scope with the gate it should always have had. Zero must-fix.

## Security — PASS

- Direction strictly fail-closed (rows removed, none added); orphan titles/metadata unreachable as candidates and as references for every actor on both transports; static error bodies; no new surface. Zero must-fix.
