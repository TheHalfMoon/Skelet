# AF-13b-i PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.46, correctness 0.44, evidence 0.50, reliability 0.45, scope 0.38, security 0.41 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: registry 5/5, mcp 11/11, parity 14/14 (incl. new deep-equal test), rest 5/5, interop-http 8/8, interop-stdio 3/3, skills validator PASS, web lint/typecheck clean, graft `build` + `check` green locally; exact-head CI proves the rest.

## Correctness — PASS

- Substring matching over name/title/description is case-insensitive and trimmed; index order preserved; empty query lists all; limits bounded server-side; MCP/REST bodies deep-equal. Zero must-fix.

## Parsimony — PASS

- One lib function, one tool schema plus handler, one REST route function plus thin glue, one skill step, one validator promotion, focused tests, one delta line. No behavior changes elsewhere. Zero must-fix.

## Product — PASS

- Completes P08 registry discovery: agents can now find components before fetching them, on both transports, with the same envelope. Zero must-fix.

## Security — PASS

- Registry capability gate on both transports with PROVIDER_DISABLED parity; malformed query/limit INVALID_INPUT on both; public static index carries no per-record oracle; leak assertions hold in parity harness. Zero must-fix.
