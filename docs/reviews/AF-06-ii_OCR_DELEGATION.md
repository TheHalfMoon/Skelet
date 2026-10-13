# AF-06-ii Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: AF-06-ii (video-evidence attachment), branch
  `skelet/af06-attach-evidence`, base
  `0ed5ca641a4aac1396fcb4dbbdac0da54d3fc686`.
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM
  provider credential is configured in this environment, so the official
  `ocr delegate` workflow was used per `GOVERNANCE.md`.
- `ocr delegate preview` (worktree): 7 reviewable / 7 total, +238/-0.
  Reviewable code: `report-assembly.ts` (+48),
  `video-frame-evidence.ts` (+81, record validator),
  `video-evidence-attachment.test.mjs` (+101), ci.yml (+1). `.ignore`
  appears in the worktree preview but is intentionally NOT staged or
  committed (preserved untracked per project policy).
- Delegated rules executed (TS/JS group; workflow group on ci.yml): no
  `var`, no `==`/`!=`, no `any`, no `eval`/dynamic import, null checks on
  every unknown input, single-level ternary only, partial-selection
  ceiling validated during development (max-index derivation rejected a
  legitimate subset and was rewritten before commit). CI change is one
  test path inside the existing lens `run:` block. No repair outstanding.
- Findings: zero unresolved blocking findings. This record MUST NOT be
  described as an LLM-backed OCR scan.
