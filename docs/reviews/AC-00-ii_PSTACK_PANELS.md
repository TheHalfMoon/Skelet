# AC-00-ii PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.65, correctness 0.22, evidence 0.31, reliability 0.33, scope 0.26, security 0.32 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: python 190/190 (182 prior + 8 new), hygiene PASS, Graft `build` + `check` green locally; no network in CI.

## Correctness — PASS

- Two frozen files at the pinned services commit with live-verified blob SHAs matching donor-pins, zero-import dependency-free candidate plus provider-coupled excluded sibling recorded, manifest scope mirrored, 8 conformance tests green offline. Zero must-fix.

## Parsimony — PASS

- One audit script, one JSON inventory, one conformance test file, one inventory-list update. No runtime transplant, no P10 code change, no board changes, no unrelated refactors. Zero must-fix.

## Product — PASS

- Completes the P10 frame-extractor per-file manifest leg of AC-00 (the P12 moodboard leg landed in AC-00-i); remaining AC-00 work is perf baselines and frozen fixtures, and no transplant is authorized by this grain. Zero must-fix.

## Security — PASS

- Blobs inspected in memory with no donor code imported, suffix guard extended to the new JSON, token via environment only, provider coupling recorded as exclusion rationale. Zero must-fix.
