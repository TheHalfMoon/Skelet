# AF-11 PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.61, correctness 0.60, evidence 0.40, reliability 0.49, scope 0.47, security 0.75 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: editor-adapters 24/24 raster PASS plus 24/24 vector PASS (48/48 total, real child processes, faithful fixture executables); typecheck/lint clean; no-model gate PASS; upstream validation PASS; 170 python tests PASS; Graft `build` + `check .` green locally; CI editor-adapters job re-verifies both suites at the exact head.
- Upstream integration coverage (honest): PhotoCraft CLI contract pinned at `9713648` (`97136485f0743251ab330d096ca6c9d0f0f6f54c`; `apps/photocraft-cli` plus `crates/automation` per AF-01 audit). The real `photocraft-cli` binary is NOT installed on this host, so genuine upstream execution was NOT performed. Fixture contract tests prove the adapter speaks the investigated `convert`/`info`/`commands` shapes with `--format`/`--quality`/`--tiff-layers` allowlisting and confined-root semantics, but upstream compatibility MUST remain UNVERIFIED until the genuine binary is installed and the same suite runs against it.
- PageDraw boundary: ArtCraft PageDraw local primitives are NOT transplanted here. Per the AF-01 manifest PageDraw is conditional on proving VectorCraft/PhotoCraft adapters insufficient; this grain provides the raster convert path (SVG/DTCG swatch -> raster bytes -> magic reopen -> Asset-ready sha) and records the boundary explicitly in `raster-adapter.ts`.

## Correctness — PASS

- Disabled-by-default is observable (disabled config short-circuits before any spawn, proven even with an executable present). Missing executable maps to unavailable without spawning. Config validation pins the exact PhotoCraft commit and absolute paths, refusing PATH lookup. `convert`/`info`/`commands` argv matches the investigated usage text with `--format` required, `--quality` 1-100 only for JPEG/WebP, `--tiff-layers flatten|preserve` only for TIFF, output extension must match format, input extension allowlisted, and `run`/`batch`/`droplet`/`mcp`/`serve` refuse as unsupported. Timeout/cancel/output-limit/malformed/failed classify per contract and are proven by hang/fail/malformed/large/abort fixtures. `validateRasterBytes` checks magic per format (PNG/JPEG/WebP/TIFF/BMP); `inspectRaster` reopens bytes plus sha. Same-file convert without `overwrite:true` is refused. Zero must-fix.

## Parsimony — PASS

- One new implementation file (`raster-adapter.ts`), one test file (`raster-adapter.test.mjs`), index export extension, one CI step (raster tests), plus Jev spec/review docs. No REST/MCP/UI wiring, no donor code, no migration, no unrelated refactor. The CI addition is the only adjacent change and is required so the new tests are qualified at exact head. No unrelated work.

## Product — PASS

- Completes the smallest coherent AF-11 grain: an optional, explicitly installed, root-confined raster convert path plus magic-based reopen validation so the swatch/SVG -> raster -> Asset journey is exercisable without the genuine binary. The adapter reports ready/unavailable/disabled deterministically so future REST/MCP surfaces can gate on it. Upstream compatibility stays honestly UNVERIFIED. PageDraw remains explicitly out of scope with a recorded conditional. Zero must-fix.

## Security — PASS

- Absolute-path-only executable with symlink/dir refusal (no PATH hijack, no unsafe fallback). Root traversal and symlink escapes refuse with path-escape (nearest-ancestor realpath check, whole-segment comparison, device-name refusal). Shell metacharacters never reach a shell (`shell: false` plus strict format/quality/path validation, proven by metachar test with no marker file created). Environment scrubbed to an allowlist (proven by env-dump test showing caller secrets absent). Raster magic mismatch refused (text/JSON/script payloads fail as malformed-output, proven by malformed plus unsafe fixtures). Anonymous invocations refused (actor/workspace identities required). Diagnostics truncated to 2000 chars. No network, no model egress, no TCP control, no HEIF/GPU/cloud enablement (`--heif` never emitted; `photocraft-heif` never referenced as a dependency), no plugin loading, no ambient credentials. Zero must-fix.
