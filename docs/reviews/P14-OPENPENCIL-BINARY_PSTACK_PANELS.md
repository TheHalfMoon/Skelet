# P14 Genuine OpenPencil Binary Qualification PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.61, correctness 0.40, evidence 0.47, reliability 0.49, scope 0.60, security 0.24 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`). Scores dispositioned in the review summary (docs-only qualification uncertainty, not a changed contract).
- Suites: openpencil 19 pass + 1 labeled genuine-binary skip without binary; 20/20 with `SKELET_OPENPENCIL_BIN` set (genuine bun-built binary at pin); vector 24/24; raster 26/26; python 221/221; graft `build` + `check` green locally.

## Correctness — PASS

- Pin equality (`78355fd` in UPSTREAMS, adapter constant, and `git rev-parse HEAD` of the isolated checkout), version 0.16.0, MIT license, reproducible dist hash (`aaa20797…`), and six-op live exercise all match the qualification claims. Fig native-ID and query-XPath nuances are recorded as non-defects. Zero must-fix.

## Parsimony — PASS

- One qualification doc, one matrix delta line, four review records. No product code, schema, API, MCP, migration, donor import, UI, or billing change. Zero must-fix.

## Product — PASS

- Closes the P14/AC-03 genuine-binary gap (export claim now backed by genuine exercise); `.fig` fidelity at scale stays per-document and PageDraw stays deferred per the record. Zero must-fix.

## Security — PASS

- No binary committed; no secrets in the doc; harness roots removed; wrapper local-only and uncommitted; adapter stays disabled by default with pin equality and confinement; no app-bridge token use. Zero must-fix.
