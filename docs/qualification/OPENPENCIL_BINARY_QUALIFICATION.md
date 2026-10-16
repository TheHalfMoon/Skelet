# OpenPencil Genuine Binary Qualification — P14/AC-03 (2026-10-16)

Status: QUALIFIED against the genuine upstream executable. This record
converts the P14 headless OpenPencil adapter's upstream compatibility from
UNVERIFIED (fixture-only) to VERIFIED for the exact pinned commit below. It
does not install, vendor, or redistribute the binary: the executable was
built from source outside the repository in an isolated temporary directory
and exercised through the committed Skelet adapter surface only.

## Binary identity

- Source: https://github.com/open-pencil/open-pencil
- Pinned commit: `78355fd3890cc9da9539235ee3b38beb917f2ed6` (identical to
  `UPSTREAMS.lock.yml` openpencil pin and `OPENPENCIL_PIN`; verified via
  `git rev-parse HEAD` in detached checkout).
- Version at pin: 0.16.0 (`packages/cli` `@open-pencil/cli`).
- License: MIT (LICENSE file at pinned commit: "Copyright (c) 2026 Danila
  Poyarkov and OpenPencil contributors"). No source import in this grain.
- Build (isolated checkout, Mac arm64):
  - `bun install --frozen-lockfile` with bun 1.3.14 (packageManager asks
    bun@1.4.2; 1.3.14 builds cleanly): 394 packages, no errors.
  - `bun run build` in `packages/cli` (tsdown): built in 5.07s, one
    pre-existing CSSOM `IMPORT_IS_UNDEFINED` warning plus one ineffective
    dynamic-import notice, exit 0.
  - Rebuild reproducibility: `packages/cli/dist/index.mjs` SHA-256
    `aaa20797e203ae23a2f49411204f870afd880477101ec9ba8eb394d2ea9afe54`
    identical before and after the rebuild.
- Runtime: `bun ./packages/cli/bin/openpencil.js` (the bin shebang says
  `node` but the bun-first install requires the bun runtime; under plain
  node the process fails resolving bun-installed deps). The qualification
  harness used a local-only wrapper script (`exec bun .../bin/openpencil.js
  "$@"`) as `executablePath`; the wrapper is a test artifact and is not
  committed. Operators must install bun plus the pinned OpenPencil checkout
  themselves; Skelet never downloads or installs it.

## Contract conformance (binary `--help` vs adapter claims)

| Upstream surface | Adapter treatment | Evidence |
| --- | --- | --- |
| `tree [FILE] --json [--page] [--depth]` | Allowlisted; adapter emits exactly `tree FILE --json` plus optional `--page`/`--depth` | `--help` text plus live `tree` run below |
| `node [FILE] --id ID --json` | Allowlisted | live `node` run below |
| `query [FILE] <SELECTOR> --json [--page] [--limit]` (XPath, e.g. `//RECTANGLE`) | Allowlisted; adapter emits `query FILE SELECTOR --json` plus optional `--page`/`--limit` | `--help` text plus live `query` run below |
| `info [FILE] --json` | Allowlisted | live `info` run below |
| `export [FILE] --format FMT --output OUT` (aliases `-f`/`-o`) | Allowlisted for fig/svg/png/jpg/jpeg/webp; adapter emits long flags only | `--help` text plus live `export` run below |
| `convert <FILE> --output OUT --format fig` (aliases `-o`/`-f`) | Allowlisted; adapter emits `convert FILE --output OUT --format fig` | `--help` text plus live `convert` run below |
| `documents|import|diff|eval|tool|tokens|fonts|formats|find|history|pages|variables|libraries|lint|analyze|selection|settings|run|mcp|serve|bench` | Refused (`openpencil/unsupported-operation`, no spawn) | by construction; not exercised against the binary |
| App-bridge options (`--document-id`, `--page-id`) | Never emitted | `buildOpenpencilArgs` contains no such flags |
| `.fig` (native) and `.pen` (JSON interchange, read-only upstream) | Accepted inputs; convert output restricted to `.fig` | live `.pen` and `.fig` runs below |

## Live exercise through the committed adapter (2026-10-16)

Harness: throwaway Node script importing
`packages/editor-adapters/src/openpencil-adapter.ts` at main HEAD `6d318a8`,
confined root `mkdtemp`, config `{ enabled: true, executablePath: <wrapper>,
rootDir: <root>, versionPin: OPENPENCIL_PIN }`, requestor
`{ actorId: "qualify", workspaceId: "qualify" }`. No test files changed;
the committed fixture suite is untouched.

- `openpencilAvailability`: `{ available: true, reason: "ready" }`.
- Reference input: Skelet-owned `buildPenDocument` shape (1 frame
  `skelet-tokens` 360x64, 1 rectangle `swatch-01` 48x48 `#ff0000`) written
  as `doc.pen`.
- `info doc.pen`: valid JSON `{ pages: 1, totalNodes: 2, types:
  { FRAME: 1, RECTANGLE: 1 }, fonts: ["Inter"] }`.
- `tree doc.pen`: 1 page entry `skelet-tokens` with 1 child `swatch-01`.
- `node doc.pen --id swatch-01`: valid JSON with id, RECTANGLE geometry,
  fills, parent `skelet-tokens`.
- `query doc.pen //RECTANGLE`: 1 result (`swatch-01`). Note: bare
  `RECTANGLE` (non-XPath) returns `[]` on the genuine binary; the adapter
  passes selectors straight through, so this is caller syntax, not a
  defect.
- `export doc.pen --format svg --output out.svg`: exit 0, 222 bytes,
  SHA-256 `f8b2a0b4f9f8406f…`. Output passes the adapter's own
  `validateOpenpencilSvgOutput` and `inspectOpenpencilSvg` (360x64,
  1 shape).
- `convert doc.pen --output out.fig --format fig`: exit 0, 29321 bytes.
  `info out.fig` returns the same 1-page/2-node summary (fig reopen proof).
- Pack journey: `buildPenDocument` output written as `pack.pen`, then
  `info pack.pen` returns the same 2-node summary (pack-to-editable-document
  leg proven against the genuine parser).
- `.fig` inputs: `tree`/`info`/`export --format svg` all succeed on the
  converted `doc.fig`; fig `tree` uses native node IDs (`0:5` for the frame
  vs `skelet-tokens` in pen) which is the upstream ID scheme, not a defect.
- Committed suite with the genuine binary:
  `SKELET_OPENPENCIL_BIN=<wrapper> node --experimental-strip-types --test
  packages/editor-adapters/tests/openpencil-adapter.test.mjs` →
  20 tests, 20 pass, 0 fail, 0 skipped (the conditional genuine-binary
  test executes instead of skipping).

## Scope and limits (honest)

- Qualified: allowlisted `tree`/`node`/`query`/`info`/`export`/`convert`
  argv shapes, JSON parseability, SVG reopen validation, `.pen` and `.fig`
  input handling, pack-to-pen-to-export-to-reopen journey, refusal paths
  (by construction), and timeout/output-cap plumbing as exercised above,
  at this exact commit on macOS arm64 with bun 1.3.14.
- NOT qualified: refused operations (deliberately uninvoked), Windows/Linux
  binaries, other commits, GPU paths (the adapter rejects GPU/cloud
  operation by design), production deployment of the binary
  (operator-installed, opt-in, confined), or hosted execution of the
  wrapper (local only).
- No adapter code fix was required: unlike the PhotoCraft qualification
  (two genuine argv defects), every adapter argv shape matched the genuine
  binary on first exercise. The committed fixture executables remain the CI
  story: CI has no upstream binary and must never download one silently.
  This document is the upstream-compatibility evidence; fixtures are the
  regression story. Both statements stay true together.
- `.fig` round-trip fidelity beyond the exercised shape (single frame,
  single rectangle, color/geometry/pages/node-count preservation) remains a
  per-document property, not a blanket claim for arbitrary upstream files.

## Disposition

P14 headless adapter upstream compatibility is VERIFIED at pin `78355fd`
for the six allowlisted file-mode operations. Remaining P14 work is the
`.fig` round-trip fidelity proof at scale (per-document, future grain) and
the PageDraw conditional (unchanged, deferred pending gap proof). This
record closes the "genuine-binary qualification before any export claim"
gap cited in the acceptance matrix P14 row and Issue #62 AC-03 item (i).
