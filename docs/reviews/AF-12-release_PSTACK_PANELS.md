# AF-12 Release Evidence (Unified) PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.56, correctness 0.20, evidence 0.39, reliability 0.52, scope 0.20, security 0.48 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: migration-rehearsal plus backup-restore 3/3 PGlite green, SBOM conformance 4/4 plus `--check` green, web build plus lint/typecheck green after override, python 182/182, hygiene PASS, bench_search measured, graft `build` + `check` green locally; CI `db-foundation` job (PGlite rehearsal + real-PG suites) wired for exact-head proof.

## Correctness — PASS

- postcss 8.4.31 replaced by exactly 8.5.30 with zero postcss advisories remaining; SBOM components match inputs (sorted, unique, purl-shaped); rehearsal proves full up/down/up symmetry with dropped tables and reheated writes; bench numbers reproduced from committed runs. Zero must-fix.

## Parsimony — PASS

- One override plus lockfile, one generator plus SBOM plus conformance tests, two qualification docs, one SLO doc, one rehearsal test plus CI line, one matrix delta, review records. No behavior changes, no new surfaces, no migration. Hosted load tests, takedown automation, gallery/flow-player UI stay explicitly deferred. Zero must-fix.

## Product — PASS

- Gives operators a remediated dependency posture with a revisit trigger, a reproducible SBOM, an executable migration rehearsal, and SLOs with measured baselines. Advances R7/P15 meaningfully while honestly bounding what remains. Zero must-fix.

## Security — PASS

- Four postcss advisories closed by upgrade with build proof; braces accepted-risk documented with dev-only rationale and revisit trigger; no advisory suppressed or downgraded; generator is offline with fixed-argv subprocess only; rehearsal runs on scratch hardware. Zero must-fix.
