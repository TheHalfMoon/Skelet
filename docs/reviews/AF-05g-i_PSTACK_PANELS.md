# AF-05g-i PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.19, correctness 0.33, evidence 0.31, reliability 0.30, scope 0.56, security 0.28 (model `jev-1.13.0`, ok true).
- Suites: lens 189/189 (186 existing + 3 guard); typecheck/lint (skelet-lens) clean. Graft `check .` green locally; CI graft job re-verifies at the exact head.

## Correctness — PASS

- Guard triage is honest: the two initial hits were a comment-only provider mirror (egress none, cost free-local) and the UI's same-origin /api transport; the test now asserts module loads and absolute URLs, and covers the allowed same-origin calls. Zero must-fix.

## Parsimony — PASS

- One test file, one prose record, one CI line. No runtime change. No unrelated refactor.

## Product — PASS

- Gives Issue #9 / AF-05g a falsifiable no-mandatory-paid-model claim: executable guard plus a qualification record with reproducible commands, prerequisites, and disclosed operator-side costs.

## Security — PASS

- Guard adds only failure modes on provider references; no secrets, no network, no surface change. Zero must-fix.
