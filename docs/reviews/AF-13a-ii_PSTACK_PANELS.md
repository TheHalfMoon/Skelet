# AF-13a-ii PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.42, correctness 0.46, evidence 0.43, reliability 0.34, scope 0.23, security 0.39 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: assets 25/25 (22 prior + 3 new), web/node/worker 112/112 (110 prior + 2 new), python 170 OK, all validators PASS (agent-contract, build-kit, registry, skills, upstreams), no-model gate PASS, hygiene PASS, Graft `build` + `check .` green locally; CI will re-verify at exact head.

## Correctness — PASS

- Diffs are hand-verified (0.6 fixture with title/summary-only field diffs, shared/unique term arrays, identical pairs with score 1 and empty diffs, reversed-operand mirroring, MCP/REST deep-equal parity). Zero must-fix.

## Parsimony — PASS

- One comparator, one tool, one route, one skill line, one validator promotion, one CI suite line, count updates in three inventory tests. No ranking changes, no donor code, no schema migration, no UI redesign. get_changes stays deferred. Zero must-fix.

## Product — PASS

- Closes P08 gap #2 from the AF-12 matrix (evidence-linked artifact comparison) on MCP, REST, and skill surfaces with contract snapshots unchanged (envelope v1). The matrix P08 row stays PARTIAL until get_changes/MCP Apps land; this grain does not claim them. Zero must-fix.

## Security — PASS

- Both identifiers gated via getArtifactForActor with no oracle about which side failed (tested both orders plus malformed), readable-but-restricted on either side denied with RIGHTS_RESTRICTED on both transports (tested), serving labels mirror registry policy with no bytes, request IDs sanitized, error bodies static with leak assertions, pair lookup only (no corpus scan, no budget needed), no shell/subprocess/network. Zero must-fix.
