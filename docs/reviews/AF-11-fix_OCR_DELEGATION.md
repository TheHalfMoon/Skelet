# AF-11 fix Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: AF-11 genuine raster fix, branch `skelet/af11-raster-genuine`, base `747faa2`.
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM provider credential is configured, so the official `ocr delegate` workflow is used per `GOVERNANCE.md`.
- Exact-diff preview (workspace at review time): 5 reviewable — `raster-adapter.ts`, `raster-adapter.test.mjs`, the two Jev JSONs, and `.ignore` (intentionally NOT staged or committed, preserved untracked per project policy); both markdown docs excluded as `unsupported_ext` (JSON key-spelling group verified clean).
- Delegated rules executed (host-agent review against the exact diff, TS/JS group): no `var`, strict equality only, no `any`, no `eval`/dynamic import, no `innerHTML`/`document.write`, no hardcoded credentials, no prototype modification, single-level ternaries only, null-guarded byte handling, no backtick breakage in fixture template literals (fixed during authoring). The two argv changes are static literals (`--json`, bare `--tiff-layers`) selected by enum-validated branches; no user input is interpolated into argv (paths are root-confined, format/quality/tiffLayers validated before construction).
- Findings: zero unresolved blocking findings. This record MUST NOT be described as an LLM-backed OCR scan.
