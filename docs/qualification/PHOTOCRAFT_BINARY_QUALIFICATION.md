# PhotoCraft Genuine Binary Qualification — AC-03 (2026-10-14)

Status: QUALIFIED against the genuine upstream executable, WITH TWO
GENUINE CODE FIXES that fixture tests could not catch. This record
converts the AF-11 adapter's upstream compatibility from UNVERIFIED
(fixture-only) to VERIFIED for the exact pinned commit below. It does
not install, vendor, or redistribute the binary: the executable was
built from source outside the repository and exercised through the
committed Skelet adapter surface only.

## Binary identity

- Source: https://github.com/storytold/photocraft
- Pinned commit: `97136485f0743251ab330d096ca6c9d0f0f6f54c` (identical to
  `UPSTREAMS.lock.yml` photocraft pin and `PHOTOCRAFT_PIN`).
- Verified HEAD after checkout: same commit (detached HEAD, `git rev-parse`).
- Build: `cargo build --release -p photocraft-cli` (cargo 1.96.0),
  completed in 3m38s with no errors.
- Binary SHA-256: `61492f5cd3aac33be15ca3296e75c954855dd54250c65c0797e1e3db3e508468`
  (local build artifact, not committed).
- License: MIT OR Apache-2.0 (upstream workspace declaration; leaf-crate
  recheck remains due before any redistribution, which this grain does not do).

## Two genuine defects found and fixed

Fixture executables emulated the adapter author's reading of the CLI
contract. The genuine binary disagreed twice, and both are now fixed in
`packages/editor-adapters/src/raster-adapter.ts` with
genuine-emulating fixtures plus regression tests:

1. **`commands` needs `--json` for machine output.** Bare `commands`
   prints a human table (`file.new ... File ...`); only
   `commands --json` prints the JSON catalogue. The adapter previously
   sent bare `commands` and `JSON.parse`d stdout, which fails closed
   (`raster/malformed-output`) against the real binary. Fix: emit
   `["commands", "--json"]`. The committed fixture now emulates the
   genuine split (text without the flag, JSON with it), so the existing
   commands test proves the flag is sent.
2. **`--tiff-layers` is a bare flag, not a valued option.** The adapter
   previously emitted `--tiff-layers flatten|preserve`; the real CLI
   rejects any mode value (`error: convert needs <in> <out>`, exit 1).
   Genuine semantics: TIFF output is flat by default, the bare flag
   keeps layers. Fix: `preserve` sends the bare `--tiff-layers` flag,
   `flatten` sends no flag. The fixture emulates the genuine rejection,
   and new unit tests pin both argv shapes.

## Contract conformance (binary `--help` vs fixed adapter)

| Upstream surface | Adapter treatment | Evidence |
| --- | --- | --- |
| `convert IN OUT [--format EXT] [--quality 1-100] [--tiff-layers]` | Allowlisted; fixed shapes above | live conversions below |
| `info FILE [--compact]` | Allowlisted as bare `info` (JSON by default) | live `info` run below |
| `commands [--json]` | Allowlisted as `commands --json` | 732-item-shaped JSON array (registry count varies; array shape asserted) |
| `run`, `batch`, `droplet`, `mcp`, `serve` | Refused pre-spawn (`raster/unsupported-operation`) | live refusals, no process spawned |
| `--quality` on lossless formats | Refused at validation (`raster/invalid-input`) | committed negative tests (unchanged) |
| HEIF | Never enabled | unchanged; separate rights review still required |

## Live exercise through the fixed adapter (2026-10-14)

Harness: throwaway Node script importing
`packages/editor-adapters/src/raster-adapter.ts` at the fix HEAD,
confined `mkdtemp` root, config `{ enabled: true, executablePath:
<binary>, rootDir: <root>, versionPin: PHOTOCRAFT_PIN }`, 1x1 PNG input
(69 bytes). No test files changed for this exercise; the committed
fixture suite is untouched by it.

- `commands`: JSON array (asserted `Array.isArray`).
- `info in.png`: JSON document (keys include `width`, `height`,
  `layers`, `mode`, `warnings`, `channels`, `timeline`).
- `convert` PNG to PNG with `--format png`: 91 bytes, PNG magic verified.
- `convert` PNG to JPEG with `--format jpeg --quality 80`: 633 bytes,
  JPEG magic verified (`warning: lossy compression` on stderr, exit 0).
- `convert` PNG to TIFF with `tiffLayers: "flatten"`: 254 bytes, TIFF
  magic verified (no `--tiff-layers` flag sent).
- `convert` PNG to TIFF with `tiffLayers: "preserve"`: 696 bytes
  (layered), TIFF magic verified (bare `--tiff-layers` sent).
- `run` / `batch` / `serve`: `raster/unsupported-operation`, no spawn.

## Scope and limits (honest)

- Qualified: allowlisted `convert`/`info`/`commands` argv shapes (as
  fixed), JSON parseability, magic-byte reopen validation, refusal
  paths, at this exact commit on macOS arm64 with this toolchain.
- NOT qualified: `run`/`batch`/`droplet`/`mcp`/`serve` behavior
  (deliberately uninvoked), Windows/Linux binaries, other commits, GPU
  or cloud paths (rejected by design), HEIF, or production deployment
  of the binary (operator-installed, opt-in, confined).
- Fixture executables in `raster-adapter.test.mjs` now emulate the
  genuine shapes above and remain the CI story: CI has no upstream
  binary and must never download one silently. This document is the
  upstream-compatibility evidence; fixtures are the regression story.
- With this record, Issue #62 journey (c) has genuine-binary evidence
  on both the vector and raster halves (see the VectorCraft record).

## Disposition

The AF-11 adapter's upstream compatibility converts from UNVERIFIED to
VERIFIED at the pinned commit for the allowlisted surface plus
refusals, inclusive of the two fixes above. AC-03 adapter qualification
is complete for VectorCraft and PhotoCraft at their pins; PageDraw
local primitives remain correctly deferred pending a demonstrated gap,
and OpenPencil remains P14 scope.
