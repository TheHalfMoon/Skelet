# AF-14a PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.35, correctness 0.31, evidence 0.27, reliability 0.42, scope 0.29, security 0.27 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: ingest 14/14 (8 prior + 6 new), web/node/worker 114/114 (112 prior + 2 new), db non-PG 113/113 including 016 up/down rollback, python 178/178, all validators PASS (agent-contract, build-kit, registry, skills, upstreams), no-model gate PASS, hygiene PASS, Graft `build` + `check .` green locally; real-PG suites (14 tests) wired in CI for exact-head proof.

## Correctness — PASS

- Counts, replay identity, conflict detection, zero-write failures, scoping, pagination, and MCP/REST deep-equal parity are all asserted by committed tests; migration rollback is proven, not assumed. Zero must-fix.

## Parsimony — PASS

- One importer, one migration pair, two read tools with two routes, one skill step, one validator promotion, CI/test wiring. No gallery UI, flow player, taxonomy, rrweb, get_changes, embeddings, or billing changes. Zero must-fix.

## Product — PASS

- Establishes the first qualified research corpus path (products/versions/screens/flows importable, listed, and recoverable by agents) and closes the P10 framework gap from the matrix; gallery UI, flow player, taxonomy, and rrweb remain follow-ons. P10 row advances but stays non-VERIFIED until those land. Zero must-fix.

## Security — PASS

- Rights are explicit per artifact with no defaults; workspace/owner bindings validated; flow visibility requires all-steps-readable with single-denial no-oracle on both transports (tested); fingerprints gate altered replay as conflict; ledger immutability and delete guards extend to flows; request IDs/cursors sanitized; error bodies static with leak assertions; no shell/subprocess/network. Zero must-fix.
