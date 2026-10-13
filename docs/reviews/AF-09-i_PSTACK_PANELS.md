# AF-09-i PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.31, correctness 0.48, evidence 0.28, reliability 0.43, scope 0.22, security 0.71 (model `jev-1.13.0`, ok true).
- Suites: db 113/113 (incl. 3 handoff/validation); typecheck/lint (skelet-db) clean. Graft `check .` green locally; CI graft job re-verifies at the exact head.

## Correctness — PASS

- Transfer atomic with ledger; chain ordered; visibility preserved; validation distinguishes ok/denied/missing with pack-grade metadata parity. Zero must-fix.

## Parsimony — PASS

- One migration, three functions, tests, evidence. Surfaces deferred to AF-09-ii. No unrelated refactor.

## Product — PASS

- Gives agent context a durable handoff core: ownership moves explicitly, provenance chains persist, staleness is inspectable — the primitives AF-09-ii surfaces will serve.

## Security — PASS

- Owner-only transfer, member-only recipients, read-gated chain and validation, denied items expose status only. The missing branch is unreachable through cascade deletes and kept as defense-in-depth. Zero must-fix.
