# AF-05f-i PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.31, correctness 0.52, evidence 0.36, reliability 0.42, scope 0.50, security 0.57 (model `jev-1.13.0`, ok true).
- Suites: db build-kit 27/27 (23 existing + 4 reaper); typecheck/lint (skelet-db) clean. Graft `check .` green locally after the change; CI graft job re-verifies at the exact head.

## Correctness — PASS

- Reap conditions match the store's own clock discipline (lease TTL, scope timeBudgetMs); timeout precedence is explicit and tested; per-run revision-guarded update plus existing releaseQuota; scanned count reported. Zero must-fix.

## Parsimony — PASS

- One function plus tests and evidence; no new table, status, surface, or dependency. SKIP LOCKED reuse of the existing transactional discipline. No unrelated refactor.

## Product — PASS

- Closes the crashed-worker wedge: quota slots no longer stuck until 30-day retention expiry; operators get typed worker-lost/timeout failures with preserved audit instead of silent wedges.

## Security — PASS

- Server-only, no tenant surface; workspace-scoped updates; opaque identifiers in operator records; error classes inside the safe taxonomy; invalid now/limit fail closed. Zero must-fix.
