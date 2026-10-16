# AF-12 Final Rerun 3 PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.72, correctness 0.34, evidence 0.43, reliability 0.29, scope 0.13, security 0.13 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`). Scores dispositioned in the review summary (docs-only measurement uncertainty, not a changed contract).
- Suites: full sweep green locally as quoted in the record.

## Correctness — PASS

- Every quoted count was produced by a real local run on base `aca627b` in this session; deltas from `96f4536` (+3 python, +5 web/worker) match the landed grains; limitations restated. Zero must-fix.

## Parsimony — PASS

- One record, one matrix delta line, three review records. No product code, schema, API, MCP, migration, donor import, dependency, UI, or billing change. Zero must-fix.

## Product — PASS

- Keeps release evidence current through PR #134; R7 still honestly PARTIAL (no signed artifact, no hosted dashboards, no production-scale load proof). Zero must-fix.

## Security — PASS

- No new surface; hashes/pins only; PG credentials are local CI fixtures. Zero must-fix.
