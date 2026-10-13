# AF-08-ii PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.44, correctness 0.53, evidence 0.30, reliability 0.35, scope 0.20, security 0.32 (model `jev-1.13.0`, ok true).
- Suites: boards-ui 4/4; typecheck/lint/build (web) green with /boards static. Graft `check .` green locally; CI graft job re-verifies at the exact head.

## Correctness — PASS

- Every control calls a real route and renders persisted results; ranks come from the store, not local state; failures surface codes. Zero must-fix.

## Parsimony — PASS

- One page, one contract test, one home link. Backend untouched. No unrelated refactor.

## Product — PASS

- Completes AF-08 end to end: ordered domain (AF-07-i) plus persisted REST backend (AF-08-i) plus a genuine operator interface with loading/empty/error/ordered states.

## Security — PASS

- Bearer in memory only, no hardcoded credentials, server authoritative, no secrets or remote code. Zero must-fix.
