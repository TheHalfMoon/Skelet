# AF-10 PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.60, correctness 0.61, evidence 0.43, reliability 0.54, scope 0.47, security 0.71 (model `jev-1.13.0`, ok true).
- Suites: editor-adapters 24/24 PASS (real child processes, faithful fixture executables); typecheck/lint clean; no-model gate PASS; upstream validation PASS; Graft `build` + `check .` green locally; CI editor-adapters job re-verifies at the exact head.
- Upstream integration coverage (honest): VectorCraft CLI contract verified live at pinned commit `6c3f9f6` (`main.rs` usage text plus `docs/mcp.md` confinement/protocol sections fetched via raw.githubusercontent). The real `vectorcraft-cli` binary is NOT installed on this host (`which vectorcraft` not found), so genuine upstream execution was NOT performed. Fixture contract tests prove the adapter speaks the verified `convert`/`info`/`commands` shapes with `--scale`/`--artboard`/`--range`/`--outline-text`/`--replace-lossy` allowlisting and `--automation-read-root`/`--automation-write-root` confinement semantics, but upstream compatibility MUST remain UNVERIFIED until the genuine binary is installed and the same suite runs against it.

## Correctness — PASS

- Disabled-by-default is observable (disabled config short-circuits before any spawn, proven even with an executable present). Missing executable maps to unavailable without spawning. Config validation pins the exact VectorCraft commit and absolute paths, refusing PATH lookup. `convert`/`info`/`commands` argv matches the verified usage text; `run`/`mcp`/`bench`/`perf` refuse as unsupported. Timeout/cancel/output-limit/malformed/failed classify per contract and are proven by hang/fail/malformed/large/abort fixtures. `tokensToSvg` is pure and deterministic (sorted inputs, fixed grid, single trailing newline); `inspectSvg` reopens dimensions and shape counts. Same-file convert without `replaceLossy` is refused. Zero must-fix.

## Parsimony — PASS

- One new package (`vector-adapter.ts` + `index.ts`), one test file, three scaffolding files (`package.json`, `tsconfig.json`, `eslint.config.mjs`), one CI job mirroring the providers job. No REST/MCP/UI wiring, no donor code, no migration, no unrelated refactor. The CI workflow addition is the only adjacent change and is required so the new package is qualified at exact head. No unrelated work.

## Product — PASS

- Completes the smallest coherent AF-10 grain: an optional, explicitly installed, root-confined vector export path plus an offline token-to-SVG projection so the reference-pack + DTCG -> editable SVG -> reopen -> Asset journey is exercisable without the genuine binary. The adapter reports ready/unavailable/disabled deterministically so future REST/MCP surfaces can gate on it. Upstream compatibility stays honestly UNVERIFIED. Zero must-fix.

## Security — PASS

- Absolute-path-only executable with symlink/dir refusal (no PATH hijack, no unsafe fallback). Root traversal and symlink escapes refuse with path-escape (nearest-ancestor realpath check, whole-segment comparison, device-name refusal). Shell metacharacters never reach a shell (`shell: false` plus strict range/scale/path validation, proven by metachar test with no marker file created). Environment scrubbed to an allowlist (proven by env-dump test showing caller secrets absent). SVG active content refused (script/javascript/foreignObject/ENTITY/on-handlers, proven by validation and script-output fixture). Anonymous invocations refused (actor/workspace identities required). Diagnostics truncated to 2000 chars. No network, no model egress, no TCP control (`--connect` never emitted), no plugin loading, no ambient credentials. Zero must-fix.
