# AF-05-R1 PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.17, correctness 0.42, evidence 0.26, reliability 0.49, scope 0.68, security 0.28 (model `jev-1.13.0`, ok true).
- Proof: `STARTER_CONSUMER_OK files=9 port=3127 placeholders=yes canary=absent` on a full local run (install/typecheck/build/start/HTTP200); CI lens job extended with the same command. Graft `check .` green locally; CI graft job re-verifies at the exact head.

## Correctness — PASS

- Assertions are live: the first full run failed closed on a README-only placeholder string and was corrected to served markers; canary absence asserted at file and HTTP levels; kit layout (sibling theme) required for the build to pass. Zero must-fix.

## Parsimony — PASS

- One proof script reusing pipeline functions and the registry-proof pattern, one CI step, one matrix section update. No runtime change. No unrelated refactor.

## Product — PASS

- Closes residual R1 with automation instead of narrative: every future head re-proves install/typecheck/build/start/smoke. Issue #9 eligible for closure on the completed matrix.

## Security — PASS

- Path confinement (repo + kit guards), argv-only process execution, loopback HTTP, no secrets, guaranteed cleanup. Zero must-fix.
