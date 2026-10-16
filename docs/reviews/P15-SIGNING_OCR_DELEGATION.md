# P15-3 Release Signing Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: P15-3 release signing procedure, branch `skelet/p15-release-signing`, base `814a2e4`.
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM provider credential is configured, so the official `ocr delegate` workflow is used per `GOVERNANCE.md`.
- Exact-diff preview (workspace mode): 1 new script (`scripts/sign_release_artifact.mjs`), 1 new test module (`tests/node/release-signing.test.mjs`, 2 tests), 1 procedure doc (`docs/operations/RELEASE_SIGNING.md`), 3 review records, plus the matrix Post-Audit Delta line, and untracked `.ignore` intentionally NOT staged or committed, preserved untracked per project policy.
- Delegated rules executed (host-agent review against the exact diff, JS + docs groups from `ocr delegate rule`):
  - JS (script): no `any`/TS-ism (plain mjs with sync exec); strict `===`/`!==` only; no `var`; no `eval`/`Function`/`innerHTML`/`document.write`; no network/fetch/http imports (only `node:child_process/crypto/fs/os/path`); subprocess argv is fixed (`gpg` plus allowlisted flags, file operands validated); passphrase is a fixed local-only sentinel for the ephemeral self-test key (never a production secret); key material removed in `finally`; numeric validation rejects non-integers/negatives; error paths exit 2/3 with bounded stderr and empty stdout.
  - JS (tests): spawned `gpg`/CLI via `process.execPath` and `execSync` PATH check with `shell:false` defaults; no network; no secrets; ephemeral material confined to `mkdtemp` (script-owned) with cleanup.
  - Docs (procedure): test-vs-production signature meaning honestly separated; production ceremony named as owner work; no release-identity claim.
  - Review records: spec/state/questions shape canonical; review JSON is genuine `jev ask` output with `ok: true`.
- Findings: zero unresolved blocking findings. This record MUST NOT be described as an LLM-backed OCR scan.
