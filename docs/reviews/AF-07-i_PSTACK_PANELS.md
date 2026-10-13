# AF-07-i PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.45, correctness 0.57, evidence 0.25, reliability 0.42, scope 0.19, security 0.36 (model `jev-1.13.0`, ok true).
- Suites: db 110/110 (incl. 4 ordering), web 72/72, python 170/170; typecheck/lint (skelet-db) clean. Graft `check .` green locally; CI graft job re-verifies at the exact head.

## Correctness — PASS

- Ranks dense by construction (backfill, append-under-lock, splice rewrite, removal renumber); out-of-range ranks rejected, absent items fail closed, replay keeps rank; DB-only append path fixed to the same rule. Zero must-fix.

## Parsimony — PASS

- One migration, domain-local helpers, one new operation, ledger updates, tests, evidence. UI exposure deferred to AF-08. No unrelated refactor.

## Product — PASS

- Gives P12 reference boards the persistence/behavior core (explicit order, moves, invariants) that any frontend must be measured against.

## Security — PASS

- Identical write gate to save/remove; cross-tenant denial; malformed IDs fail closed; parent locks converge concurrent writers. Zero must-fix.
