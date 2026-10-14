# AF-12 operations PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.46, correctness 0.39, evidence 0.48, reliability 0.49, scope 0.35, security 0.30 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: drill tests green on PGlite and real PostgreSQL locally, db non-PG suite green, python 178/178, validators + hygiene PASS, lint/typecheck clean (db), Graft `build` + `check .` green locally; CI `db-foundation` job (PGlite + real PG) wired for exact-head proof.

## Correctness — PASS

- Snapshot/wipe/restore/verify round-trips with preserved IDs on both engines; invalid snapshots (bad version, non-array tables, hostile columns) fail closed with the corpus intact; double-restore fails on primary keys without duplication. The column-identifier finding from OCR delegation is fixed and regression-tested. Zero must-fix.

## Parsimony — PASS

- One backup module, two drill tests, one runbook, CI wiring, one delta entry, review records. No behavior changes, no new surfaces, no migration. Per-item takedown automation, load/SLO work, and SBOM stay explicitly deferred with the manual procedure defined. Zero must-fix.

## Product — PASS

- Gives operators an executable restore proof plus the first canonical runbook (backup, restore drill, takedown procedure, quotas/abuse, upgrades, incidents). Advances R6/P15 meaningfully while honestly bounding what remains. Zero must-fix.

## Security — PASS

- Dumps carry workspace content: the runbook requires encryption and operator-only access. The PG drill gate refuses non-local/non-fixture targets. TRUNCATE bypass of row-level guards is documented with no-dangling-refs reasoning, and row-level takedown is explicitly separate. Snapshot column validation closes the interpolation surface; values stay parameterized. Zero must-fix.
