# AC-01 Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: AC-01 frame decision, branch `skelet/ac01-frame-decision`, base `a4cd2eb`.
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM provider credential is configured, so the official `ocr delegate` workflow is used per `GOVERNANCE.md`.
- Exact-diff preview (workspace mode): 1 reviewable file (`.ignore`, intentionally NOT staged or committed, preserved untracked per project policy). The decision markdown falls under `unsupported_ext` and the conformance test under OCR `default_path` exclusions; correctness of both is covered by the 7/7 green conformance tests plus the offline two-tier design (no network in CI).
- Delegated rules executed (host-agent review against the exact diff, Python group):
  - Python: no mutable defaults or shared state (module constants only, read-only file reads), no bare except, no secrets, no subprocess/shell/pickle, regexes bounded to the two cited source files, assertions fail closed with messages. No repair needed.
- Findings: zero unresolved blocking findings. This record MUST NOT be described as an LLM-backed OCR scan.
