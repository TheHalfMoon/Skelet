# AF-12 Release Evidence (Unified) Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: AF-12 release evidence (unified), branch `skelet/af12-release-evidence`, base `017639e`.
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM provider credential is configured, so the official `ocr delegate` workflow is used per `GOVERNANCE.md`.
- Workspace preview (`ocr delegate preview`): 8 reviewable / 15 total. Markdown docs excluded as `unsupported_ext` (their prose validated by build/tests, not by OCR); `pnpm-lock.yaml` and `tests/test_sbom.py` excluded as `default_path`; `.ignore` appears in preview only and is intentionally NOT staged or committed (preserved untracked per project policy).
- Delegated rules executed (host-agent review against the exact diff, Python + TS/JS + JSON + package.json + workflow groups):
  - Python (`generate_sbom.py`, `test_sbom.py`): `yaml.safe_load` (never `load`); fixed-argv `subprocess.run` without `shell=True`; specific `ValueError` (no bare `except`); no mutable defaults; no hardcoded secrets; offline only (lockfile + requirements pins, zero network). No repair needed.
  - TS/JS (`migration-rehearsal.test.mjs`): `const`-only, strict assertions, optional-chaining null guards, zero ternaries, sequential awaits are order-dependent by design (up/write/down/up must not parallelize), no `eval`/dynamic import/`innerHTML`, no credentials, no prototype modification. No repair needed.
  - JSON (`sbom.json`): generated artifact, byte-verified by `--check` plus 4/4 conformance tests (envelope, sorting/uniqueness, purl shape, toolchain pins, requirements coverage). No repair needed.
  - package.json: override pins exact `8.5.30` (never `latest`/`*`); no dependency conflicts introduced. No repair needed.
  - Workflow (`ci.yml`): one-line suite addition mirroring listed siblings; no secrets in `run:` blocks; checkout pinning and permissions unchanged. No repair needed.
- Supersession note: two earlier scoped review sets for this branch (`AF-12-rel_*`, pre-override posture-only scope; `AF-12-evidence-i_*`, pre-unification scope) were worktree-only, never merged, and are superseded by this unified record plus the unified Jev review. No evidence is double-counted.
- Findings: zero unresolved blocking findings. This record MUST NOT be described as an LLM-backed OCR scan.
