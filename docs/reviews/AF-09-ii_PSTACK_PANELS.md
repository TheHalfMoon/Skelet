# AF-09-ii PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.42, correctness 0.55, evidence 0.49, reliability 0.34, scope 0.40, security 0.45 (model `jev-1.13.0`, ok true).
- Suites: boards 6/6 (incl. 2 handoff), mcp-boards 3/3, mcp 10/10 (16-tool list), boards-ui 5/5; typecheck/lint/build (web) green with 3 new board routes; full pnpm test 107/107. Graft `build` + `check .` green locally; CI graft job re-verifies at the exact head.

## Correctness — PASS

- MCP board tools delegate to the same boards.ts route layer as REST, so envelopes, codes, and safe messages are identical by construction (lens parity pattern). BoardId-or-URI resolution requires agreement, fails INVALID_INPUT when missing/mismatched, opaque FORBIDDEN_OR_NOT_FOUND when malformed. REST handoff/handoffs/validation bind path id with bearer/rate-limit guards. UI posts real JSON bodies and renders ledger chain plus ok/denied/missing validation. REST/MCP convergence proven on the same ledger row. Zero must-fix.

## Parsimony — PASS

- Three thin REST routes, three MCP tools plus one resolver and one envelope helper, one UI section, two extended test files plus one new MCP test file, two count updates, one time-robustness test fix. No migration, no domain change, no unrelated refactor. The lens-jobs expiry fix (fixed BASE+31d to relative now+32d) is the only adjacent change and is justified as a CI-blocking calendar time bomb. No unrelated work.

## Product — PASS

- Completes the AF-09 handoff primitive AF-09-i deferred: ownership moves explicitly via REST/MCP/UI, provenance chains persist and are listable, per-item staleness is inspectable before transfer. Agent A hands off, agent B lists and validates by stable skelet://collection/{id} URI without the original session. Zero must-fix.

## Security — PASS

- Owner-only transfer, member-only recipients, self-transfer INVALID_INPUT, workspace aliasing rejected, outsider-vs-missing answered identically (no oracle), denied validation items expose status only, malformed identifiers opaque, bearer + rate-limit on all routes, no secrets, no remote code, no model egress (boards layer still forbids providers/fetch). Zero must-fix.
