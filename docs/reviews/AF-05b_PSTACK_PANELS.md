# AF-05b PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback per repository policy. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.27, correctness 0.49, evidence 0.52, reliability 0.34, scope 0.43, security 0.23 (model `jev-1.13.0`, ok true).

## Correctness — PASS

- 3 synthetic example.org pages with distinct titles/sections; scope selected-pages with both viewports resolves 3 pages with deterministic hash across viewport orderings; traversal completes 3/3 under budget via offline stub.
- Each page renders desktop+mobile via real offline Chromium with viewport binding, 1280x720 and 390x844 dimension proof, coverage gaps, and source binding; reports are partial with unknown-rights assets; 6 distinct analysisIds prove screenshots differ per viewport.
- Zero must-fix.

## Parsimony — PASS

- One test file plus one CI line; reuses qualified scope/traversal/capture/report entrypoints; no new source module, no contract change, no second fixture system.

## Product — PASS

- Satisfies Build Kit fixture item (committed reproducible 3-page fixture with desktop/mobile captures, evidence references, coverage gaps, provenance, rights classification); no fabricated screenshots; deterministic and offline.

## Security — PASS

- Synthetic example.org only, no live network; offline JS-disabled blocked-resources renders; unknown-rights assets never marked downloadable; scope/traversal/report gates fail closed. Zero must-fix. Graft blast shows no outside dependents; CI YAML change has no parser coverage by design.
