# P14 Headless OpenPencil Adapter PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.57, correctness 0.50, evidence 0.43, reliability 0.35, scope 0.21, security 0.29 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`). Scores dispositioned in the review summary (additive-only compatibility; fixture-bound correctness with live-verified argv).
- Suites: openpencil 19 pass + 1 labeled genuine-binary skip; vector 24/24; raster 26/26; lint clean; typecheck clean; graft `build` + `check` green locally (blast radius empty on uncommitted diff because blast compares committed HEAD; re-run after commit for the PR record).

## Correctness — PASS

- Allowlisted file-mode argv matches the pinned CLI source (tree/node/query/info/export/convert with `--json`, `--id`, `--page`, `--depth`, `--limit`, `--format`, `--output`, `--scale`, `--quality`); app-mode and `--document-id`/`--page-id` refused; `.fig`/`.pen` readability and fig-only writability match `io/formats.ts`; pen helper emits valid JSON with frame/rectangle children per `mapNodeType`; SVG guard matches vector semantics. Zero must-fix.

## Parsimony — PASS

- One adapter module, one test module, index exports, one CI line, three review records. No schema, API, MCP, migration, donor import, UI, or billing change. Zero must-fix.

## Product — PASS

- Opens the P14 adapter leg (disabled-by-default headless document path with pack-to-pen-to-export-to-reopen journey on fixtures); P14 stays PARTIAL until genuine-binary qualification plus `.fig` round-trip fidelity proof land. Zero must-fix.

## Security — PASS

- execFile without shell; absolute-path binary; pin equality; realpath confinement with symlink/traversal/device-name refusal; scrubbed env with sentinel-tested secret exclusion; SIGKILL timeout plus abort cancellation; input/output budgets; truncated diagnostics; unsafe-SVG refusal; anonymous and pack-mismatch refusal. Zero must-fix.
