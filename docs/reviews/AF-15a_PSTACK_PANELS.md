# AF-15a PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.55, correctness 0.37, evidence 0.42, reliability 0.43, scope 0.24, security 0.33 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: db 127/127 (116 prior + 11 new), web/node/worker 121/121 (118 prior + 3 new), ingest 14/14, assets 25/25, python 182/182, all validators PASS (agent-contract, skills, registry, build-kit, upstreams), no-model gate PASS, hygiene PASS, Graft `build` + `check` green locally; real-PG suites wired in CI for exact-head proof.

## Correctness — PASS

- Added, removed, changed, reordered, identical, empty, unsupported, missing, malformed, private, rights, ledger-duplicate, pagination, repeatability, and MCP/REST deep-equal parity are all asserted by committed tests; ledger-backed stable keys preserve source identities for corpus duplicates; tags equality replaces version-scoped hash comparison with documented rationale. Zero must-fix.

## Parsimony — PASS

- One diff module, one MCP tool, one REST route plus route file, one skill step, one validator promotion, inventory count updates in three tests, one CI suite line. No scheduling, scoring, embeddings, MCP Apps, gallery UI, flow player, taxonomy, OpenPencil, billing, or unrelated refactors. Zero must-fix.

## Product — PASS

- Establishes the first qualified P13 version-change path (two versions of one product diff to evidence-linked records without model prose) and closes the P13 NOT STARTED state for the read API; scheduling, watch policies, and meaningful-change scoring remain follow-ons. P13 row advances but stays non-VERIFIED until those land. Zero must-fix.

## Security — PASS

- Version IDs gated with no oracle distinguishing missing from malformed (both FORBIDDEN_OR_NOT_FOUND), cross-product answers INVALID_INPUT without leaking membership, artifacts filtered by getArtifactForActor before diffing with private titles never in JSON, flows visible only when every step readable, restricted artifacts labeled not served as bytes, request IDs/cursors sanitized, error bodies static with leak assertions, no shell/subprocess/network. Zero must-fix.
