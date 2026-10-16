# AF-12 Final Rerun 4 PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.72, correctness 0.33, evidence 0.49, reliability 0.27, scope 0.17, security 0.15 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`). Scores dispositioned in the review summary (docs-only measurement uncertainty, not a changed contract).
- Suites: full sweep green locally as quoted in the record.

## Correctness — PASS

- Every quoted count was produced by a real local run on base `70da1ba` in this session; deltas from `aca627b` (+3 python, +9 web/worker) match the landed grains; the batched web/worker method and its reason are disclosed. Zero must-fix.

## Parsimony — PASS

- One record, one matrix delta line, three review records. No product code, schema, API, MCP, migration, donor import, dependency, UI, or billing change. Zero must-fix.

## Product — PASS

- Keeps release evidence current through PR #140; R7 still honestly PARTIAL (no hosted dashboards, no production-scale load proof, no production release identity). Zero must-fix.

## Security — PASS

- No new surface; hashes/pins only; PG credentials are local CI fixtures. Zero must-fix.
