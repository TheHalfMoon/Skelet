# AF-08-i PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.30, correctness 0.38, evidence 0.18, reliability 0.38, scope 0.24, security 0.33 (model `jev-1.13.0`, ok true).
- Suites: boards 4/4; typecheck/lint/build (web) green with 5 board routes. Graft `check .` green locally; CI graft job re-verifies at the exact head.

## Correctness — PASS

- Layer mirrors the lens-jobs contract shape (allowlisted fields, opaque denial, safe INVALID_INPUT); invalid-collection maps to INVALID_INPUT while auth/unknown/cross-tenant stay opaque; store owns ordering/transactions. Zero must-fix.

## Parsimony — PASS

- One server layer, five thin routes, one test file. No migration, no MCP/UI in this slice. No unrelated refactor.

## Product — PASS

- Gives AF-08-ii a real persisted REST backend (CRUD + ordered items + moves) to wire the board interface against; no mock data path remains.

## Security — PASS

- Membership-resolved authority, aliasing rejection, laundering guard, bearer/rate-limit route guards, no secrets or remote code. Zero must-fix.
