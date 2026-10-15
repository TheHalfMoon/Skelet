# AF-14d Gallery Reads PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.48, correctness 0.36, evidence 0.39, reliability 0.43, scope 0.35, security 0.3 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: db 133/133 (127 prior + 6 new), web/node/worker 128/128 (125 prior + 3 new), python 217/217, all validators PASS, lint/typecheck clean on db plus web, Graft `build` + `check` green locally; real-PG suites wired in CI for exact-head proof.

## Correctness — PASS

- Products/versions listed only with readable evidence via the central gate per artifact; unknown products read as empty with no oracle; malformed IDs fail invalid-input on both transports; deterministic orders with examined caps and truncation flags; version IDs feed flow/change tools (proven by the gallery journey test). Zero must-fix.

## Parsimony — PASS

- One gallery module, two MCP tools, two REST routes plus route files, one skill step, one validator promotion, inventory updates, one CI suite line. No gallery UI, flow player, taxonomy, rrweb, embeddings, or billing changes. Zero must-fix.

## Product — PASS

- Establishes the first qualified product/version gallery path and closes the version-discoverability gap for flows and changes; gallery UI, flow player, taxonomy, and rrweb remain follow-ons. P10 row advances but stays non-VERIFIED until those land. Zero must-fix.

## Security — PASS

- Private and orphan titles never appear in gallery JSON on either transport; unknown and withheld products answer alike; request IDs/cursors sanitized; error bodies static with leak assertions; no shell/subprocess/network. Zero must-fix.
