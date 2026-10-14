# AF-13b Coverage Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: AF-13b coverage analysis, branch `skelet/af13b-coverage`, base `e94611b`.
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM provider credential is configured, so the official `ocr delegate` workflow is used per `GOVERNANCE.md`.
- Workspace preview (`ocr delegate preview`): 3 reviewable / 5 total. Both markdown documents (coverage record, matrix delta) excluded as `unsupported_ext`; `.ignore` appears in preview only and is intentionally NOT staged or committed (preserved untracked per project policy). Reviewable: the two Jev JSONs.
- Delegated rules executed (host-agent review, JSON group): both Jev JSONs parse as valid JSON, carry the verified base SHA `e94611ba50820dc60fca1e2601245c12b4babb0c` (corrected from a mistyped suffix before the run; never executed with the wrong value) and branch `skelet/af13b-coverage`, state `WORKTREE` head honestly. The excluded prose was verified by other gates: schema citations checked against migration files, suite counts transcribed from runs on this branch (mcp 11/11, parity 14/14, rest 5/5, skills validator PASS).
- Findings: zero unresolved blocking findings. This record MUST NOT be described as an LLM-backed OCR scan.
