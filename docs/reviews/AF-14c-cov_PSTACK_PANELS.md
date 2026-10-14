# AF-14c Coverage PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.63, correctness 0.24, evidence 0.21, reliability 0.36, scope 0.14, security 0.66 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites re-executed on this branch: boards 9/9, boards-ui 5/5, parity/rest 19/19.

## Correctness — PASS

- get_object pack branches verified in handler and route; export schema semantics verified in `reference-packs.ts`; stale-skip and partial-warning behavior covered by re-proven suites. Zero must-fix.

## Parsimony — PASS

- One record plus one delta line plus review records. No product change. Zero must-fix.

## Product — PASS

- Settles the AF-14c line items without duplicating a working surface or forking the pack format. Zero must-fix.

## Security — PASS (with noted trend)

- Jev security skepticism across coverage grains is acknowledged in the review summary; the record answers with code citations plus the reopen condition, preserves the packs gate (no new path), and proposes no bypass. Zero must-fix.
