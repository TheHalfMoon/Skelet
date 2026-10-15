# P10-D1 Replay Ledger PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.52, correctness 0.54, evidence 0.42, reliability 0.44, scope 0.67, security 0.32 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`). Scores dispositioned in the review summary (ledger-first split; reverted savepoint with budget-gate reasoning).
- Suites: replay 7/7 (incl. 2000-event budget exhaustion); migration rehearsal green; lint/typecheck clean; graft `build` + `check` green locally.

## Correctness — PASS

- Explicit-consent sessions on readable flows; strict envelope validation; pre-storage masking of input text, mutation values, and credential customs; per-session ordering; close lifecycle; event/byte budgets with zero-write rejection; deterministic repeat reads. Zero must-fix.

## Parsimony — PASS

- One migration pair, one DB module, one test module, one CI line, three review records. No transport, UI, donor, or permission change. Zero must-fix.

## Product — PASS

- Opens the P10-D replay leg (record with consent plus deterministic replay at the ledger layer); MCP/REST transport and player replay stay an explicit D2 follow-on; live rrweb capture stays future. Zero must-fix.

## Security — PASS

- Raw passwords and tokens never stored (masked pre-insert with secret-absence assertion); outsider opens/records/reads/closes read as null without oracle; malformed envelopes fail closed; actor binding on every call; readability re-checked on record and replay; no network. Zero must-fix.
