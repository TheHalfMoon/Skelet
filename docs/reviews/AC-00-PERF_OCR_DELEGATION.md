# AC-00 Perf Baseline Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: AC-00 perf baseline, branch `skelet/ac00-perf-baseline`, base `e636adb`.
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM provider credential is configured, so the official `ocr delegate` workflow is used per `GOVERNANCE.md`.
- Exact-diff preview (workspace mode): 4 reviewable files (bench script, node test, both JEV JSONs) plus `.ignore` (intentionally NOT staged or committed, preserved untracked per project policy). The review markdowns fall under `unsupported_ext`; their claims are covered by the green runs plus the recorded full-size baseline.
- Delegated rules executed (host-agent review against the exact diff, TS/JS + JSON groups):
  - TS/JS: no `var`, strict equality only, no `any`/types (plain JS), no `eval`/dynamic import, no `innerHTML`/`document.write`, no hardcoded credentials, no prototype modification, one single (non-nested) ternary, seeded arrays never indexed empty (CLI args clamped positive with versions at minimum 2), async main with try/finally DB close, subprocess call bounded by timeout with fail-closed assertions. One genuine edge-case fix during review (versions clamp for the diff op). No repair remaining.
  - JSON: key spelling matches the review group; values ignored per rule.
- Findings: zero unresolved blocking findings. This record MUST NOT be described as an LLM-backed OCR scan.
