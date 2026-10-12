# AF-03c Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: AF-03c, branch `skelet/af03c-interop`, base
  `27d6b3a341859adb3a09781061465ac249313d79`, implementation heads
  `1531a5145ee38955a6bd18b4952066b769306285` (interop),
  `cf5499fbe01d4d0643cfcb0a9a974485ac2cd856` (concurrent-key convergence),
  `6f0c83c2b19059f24137f5a61dcf55d26a5a2ebe` (OCR scope fix + Jev evidence),
  `ac62967c5a918fc2b70a31dcc057d9a32ca135f4` (bootstrap Node for wire tests).
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM
  provider credential is configured in this environment, so the official
  `ocr delegate` workflow was used per `GOVERNANCE.md`.
- `ocr delegate preview --from <base> --to HEAD` on `cf5499f`: 30 reviewable /
  32 total. Excluded by OCR itself: `tests/test_mcp_interop_py.py`,
  `tests/test_skelet_sdk.py` (`default_path`; Python group covered separately
  below). No files excluded by hand.
- `ocr delegate preview` on `6f0c83c` (adds `docs/reviews/AF-03c_JEV_SPEC.json`
  and `AF-03c_JEV_REVIEW.json`): 32 reviewable / 34 total. Same 2 Python
  exclusions; the 2 added reviewable files are the Jev JSON pair (same
  key-spelling rule group, no finding).
- Delegated rules executed against the exact diff:
  - System TS/JS group (`ocr delegate rule` on the 6 core TS/JS paths):
    no `var`, no `==`/`!=` (only `===`/`!==` and `??`), no `any` type in
    product code, no nested ternaries, no `eval`/`Function`/`innerHTML`/
    `document.write`, no native prototype mutation, no hardcoded business
    URLs beyond the canonical `skelet://` URI scheme (one `http://` fallback
    in the test server URL builder for `127.0.0.1`, test-only), no secrets
    or credentials in output. Async paths use `async/await` with `try/catch`
    mapping to the canonical catalog; pack export loops stay intentionally
    sequential (ordered export with per-item actor gates), not parallelizable
    without changing denial semantics. Null checks via `isRecord`,
    `typeof`, and `Array.isArray` before destructuring.
  - System Python group (`ocr rules check` on `scripts/skelet_sdk.py`,
    `tests/test_mcp_interop_py.py`): no `eval`/`exec`/`pickle`, subprocess
    uses an argument list with no `shell=True`, no mutable default
    arguments, no bare `except:` (narrowed to `ValueError`/`OSError` for the
    non-JSON error-body fallback), Popen pipes closed in `stop_server`
    finally, no unused imports after removing `sys`.
  - Two pre-commit findings closed: broad `except Exception` narrowed in
    `scripts/skelet_sdk.py`, unused `sys` import dropped in
    `tests/test_mcp_interop_py.py`. Green delta re-verified with
    `python -m unittest tests.test_mcp_interop_py tests.test_skelet_sdk`.
- Findings: zero unresolved blocking findings. This record MUST NOT be
  described as an LLM-backed OCR scan.
- Workflow group (`ocr delegate rule` on `.github/workflows/ci.yml`):
  no `pull_request_target` misuse, no secrets in logs, `permissions:
  contents: read` least-privilege, third-party actions pinned to full SHA
  (`actions/setup-node@82076278...`), no script injection, no hardcoded
  credentials, `fetch-depth: 0` preserved, `timeout-minutes: 10` and
  concurrency group preserved. The 11-line bootstrap addition (setup-node
  22.23.1 + pnpm 9.12.0 + frozen install) enables Python urllib wire tests
  on exact-head CI with no other workflow change.
- Recount on evidence head `ac62967c5a918fc2b70a31dcc057d9a32ca135f4`:
  `ocr delegate preview` reports 33 reviewable / 37 total. The 4 excluded
  by OCR itself are this record + `AF-03c_PSTACK_PANELS.md` (markdown
  `unsupported_ext`) + `tests/test_mcp_interop_py.py` +
  `tests/test_skelet_sdk.py` (`default_path`; Python group covered above).
  Jev was rerun on the evidence head with zero blocking findings.
