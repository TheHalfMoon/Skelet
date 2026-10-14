# AF-13a-i PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.61, correctness 0.40, evidence 0.42, reliability 0.48, scope 0.21, security 0.31 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: assets 22/22 (13 existing + 9 new), web/node/worker 110/110 (107 existing + 3 new), python 170 OK, all validators PASS (agent-contract, build-kit, registry, skills, upstreams), no-model gate PASS, Graft `build` + `check .` green locally; CI will re-verify at exact head.

## Correctness — PASS

- Jaccard scoring is hand-verified against fixtures (0.6 / 0.1667 / 0.1429), tie-break by title then id is tested, kinds/limit/offset/truncation paths are tested, and MCP/REST envelopes are deep-equal by test. The nested-ternary finding from OCR delegation is fixed and re-verified. Zero must-fix.

## Parsimony — PASS

- One tool, one route, one skill step, one validator promotion, one CI suite line, count updates in three inventory tests. No ranking changes, no donor code, no schema migration, no UI redesign. compare_design is explicitly deferred to the next grain. Zero must-fix.

## Product — PASS

- Closes P08 gap #1 from the AF-12 matrix (artifact-to-similar-artifact via a deterministic baseline) on MCP, REST, and skill surfaces with contract snapshots unchanged (envelope v1). The matrix row stays PARTIAL until compare_design/get_changes/MCP Apps land; this grain does not claim them. Zero must-fix.

## Security — PASS

- Reference gate via getArtifactForActor with no-oracle mapping on both transports (tested: malformed/unknown/denied identical), workspace-membership predicate filters candidates before scoring (tested: private candidates excluded for outsiders, included for owners), restricted references denied with RIGHTS_RESTRICTED while candidates keep labeled list semantics (tested), request IDs and cursors sanitized, error bodies static with leak assertions, candidate budget bounded in SQL, no shell/subprocess/network/secret. Zero must-fix.
