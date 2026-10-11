# AF-02 Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: AF-02, branch `skelet/af02-no-model-egress`, base
  `09eb5e25d5ccf661ed6ae0878298f8bdedec5fcc`, implementation head
  `639ba118d4ce8eef0dadd2d5b0aefdab14c5088a`.
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM
  provider credential is configured in this environment, so the official
  `ocr delegate` workflow was used per `GOVERNANCE.md`.
- `ocr delegate preview --from <base> --to HEAD`: 11 reviewable / 13 total.
  Reviewable: `.github/workflows/ci.yml`, `apps/worker/src/cli.ts`,
  `apps/worker/src/env.ts`, `apps/worker/tests/cli.test.mjs`,
  `apps/worker/tests/env.test.mjs`, `packages/no-model/eslint.config.mjs`,
  `packages/no-model/package.json`, `packages/no-model/src/no-model.ts`,
  `packages/no-model/tests/no-model.test.mjs`,
  `packages/no-model/tsconfig.json`, `scripts/check_no_model.py`.
  Excluded by OCR itself: `pnpm-lock.yaml` and `tests/test_no_model.py`
  (`default_path`). The lockfile addition is a single new importer with
  pinned versions identical to existing packages. The Python test is covered
  by the hosted bootstrap unittest suite (156 tests including 12 new AF-02
  tests) and local Node suites.
- Delegated rules executed against the exact diff (`ocr delegate rule`):
  - Group workflow (`ci.yml`): pinned third-party actions to full commit
    SHAs, `permissions: contents: read`, no `pull_request_target`, no
    secrets in logs, `fetch-depth: 0` on every checkout, `timeout-minutes`
    on the new job, existing `concurrency` group retained, no script
    injection from event payloads, no hardcoded credentials. No finding.
  - Group TS/JS (worker env, worker CLI, worker tests, no-model source
    and tests, eslint config): no `var`, no `==`/`!=`, no `any`, no nested
    ternary, no `eval`/`Function`/`innerHTML`/`document.write`, no secret
    values, no prototype mutation, no dead code, no commented-out blocks,
    error messages spelled consistently. No finding.
  - Group package.json (`packages/no-model/package.json`): no `latest` or
    `*` versions, no duplicate dependency declarations, `eslint` and
    `typescript` declared in `devDependencies` and used in `scripts`.
    No finding.
  - Group JSON (`packages/no-model/tsconfig.json`): key spelling matches
    existing package configs (`extends`, `compilerOptions`, `baseUrl`,
    `types`, `allowImportingTsExtensions`, `include`, `exclude`).
    No finding.
  - Group Python (`scripts/check_no_model.py`): no mutable defaults, no
    bare `except`, specific `OSError`/`UnicodeDecodeError`/`ValueError`
    handling, no silent `pass`, no `assert` for runtime validation, no
    `subprocess` shell, no `pickle`/`yaml.load`, no secret values in output
    (names only), no path traversal join. No finding.
- Findings: zero unresolved blocking findings. This record MUST NOT be
  described as an LLM-backed OCR scan.
