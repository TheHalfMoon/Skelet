# AF-05-R1 Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: residual R1 (consumer smoke), branch `skelet/af05-r1-consumer-smoke`,
  base `f3832a08423b7cebe85794602a42455e791e8a5c`.
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM
  provider credential is configured in this environment, so the official
  `ocr delegate` workflow was used per `GOVERNANCE.md`.
- `ocr delegate preview` (worktree): 5 reviewable / 6 total, +214/-20.
  Reviewable code: `scripts/prove_starter_consumer.mjs` (+178),
  `.github/workflows/ci.yml` (+3). Excluded by OCR itself
  (`unsupported_ext`): `docs/qualification/ISSUE_9_MATRIX.md`, covered by
  the R1 proof run plus the manual panel below instead. `.ignore` appears
  in the worktree preview but is intentionally NOT staged or committed
  (preserved untracked per project policy).
- Delegated rules executed (JS group on the script; workflow group on
  ci.yml): no `var`, no `==`/`!=`, no `eval`, argv-array exec/spawn with
  no shell interpolation, fixture/starter paths confined (repo root and
  kit dir guards), loopback-only HTTP, temp cleanup in `finally`, CI
  change is one step in the existing lens job with no new expression,
  secret, action, or permission. One live finding during development (a
  wrong placeholder assertion) failed closed as designed and was
  corrected to the served markers — preserved as negative evidence in
  the grain record, not hidden.
- Findings: zero unresolved blocking findings. This record MUST NOT be
  described as an LLM-backed OCR scan.
