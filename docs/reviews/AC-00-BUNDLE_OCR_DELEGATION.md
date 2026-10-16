# AC-00 Bundle Baseline Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: AC-00 bundle baseline, branch `skelet/ac00-bundle-baseline`, base `b5e9fd9`.
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM provider credential is configured, so the official `ocr delegate` workflow is used per `GOVERNANCE.md`.
- Exact-diff preview (workspace mode): 1 new script (`scripts/check_bundle_budget.mjs`), 1 new test module (`tests/node/bundle-budget.test.mjs`, 4 tests), 1 baseline doc (`docs/qualification/BUNDLE_BASELINE.md`), 2 CI lines (build pipe plus check step in the `web` job), 3 review records, plus the matrix Post-Audit Delta line, and untracked `.ignore` intentionally NOT staged or committed, preserved untracked per project policy.
- Delegated rules executed (host-agent review against the exact diff, JS + workflow + docs groups from `ocr delegate rule`):
  - JS (script): no `any`/TS-ism (plain mjs with exported pure functions); strict `===`/`!==` only; no `var`; no `eval`/`Function`/`innerHTML`/`document.write`; no network/fetch/http imports (only `node:fs/promises`); numeric parsing rejects non-finite/negatives; byte budgets on inputs; error paths exit 2 with empty stdout.
  - JS (tests): offline only (frozen string sample, no build, no network); breach and fail-closed assertions.
  - Workflow: the two added lines pipe the existing build output to the check (no second build, no new secrets, pinned actions untouched, `timeout-minutes` untouched, exact-HEAD verification untouched).
  - Docs (baseline): measured numbers match the real local build; budgets with headroom rationale; LCP/INP/CLS honestly excluded; toolchain re-baseline rule stated.
  - Review records: spec/state/questions shape canonical; review JSON is genuine `jev ask` output with `ok: true`.
- Findings: zero unresolved blocking findings. This record MUST NOT be described as an LLM-backed OCR scan.
