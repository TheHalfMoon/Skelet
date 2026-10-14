# VectorCraft Genuine Binary Qualification — AC-03 (2026-10-14)

Status: QUALIFIED against the genuine upstream executable. This record
converts the AF-10 adapter's upstream compatibility from UNVERIFIED
(fixture-only) to VERIFIED for the exact pinned commit below. It does
not install, vendor, or redistribute the binary: the executable was
built from source outside the repository and exercised through the
committed Skelet adapter surface only.

## Binary identity

- Source: https://github.com/storytold/vectorcraft
- Pinned commit: `6c3f9f60aa69ac151f9908b94cf00a387746eea4` (identical to
  `UPSTREAMS.lock.yml` vectorcraft pin and `VECTORCRAFT_PIN`).
- Verified HEAD after checkout: same commit (detached HEAD, `git rev-parse`).
- Build: `cargo build --release -p vectorcraft-cli` (cargo 1.96.0),
  completed in 4m20s with no errors.
- Binary SHA-256: `a311bd2615d5ab25888384dc816d22570616ffd6b69640269888a07d5ded4bc4`
  (`/tmp/vc-qualify/target/release/vectorcraft-cli`, local build artifact,
  not committed).
- License: MIT OR Apache-2.0 (upstream workspace declaration; leaf-crate
  recheck remains due before any redistribution, which this grain does not do).

## Contract conformance (binary `--help` vs adapter claims)

| Upstream surface | Adapter treatment | Evidence |
| --- | --- | --- |
| `convert IN OUT [--scale N] [--artboard I \| --range R] [--outline-text] [--replace-lossy]` | Allowlisted; adapter emits exactly these flags | `--help` text plus live `convert` run below |
| `info FILE` (JSON summary) | Allowlisted | live `info` run below |
| `commands` (JSON catalogue) | Allowlisted | 732 catalogue entries returned as JSON |
| `run` (arbitrary command IDs) | Refused (`vector/unsupported-operation`, no spawn) | live refusal, no process spawned |
| `mcp` (long-lived server) | Refused (never invoked) | by construction; not exercised against the binary |
| `bench` / `perf` (benchmark harnesses) | Refused (`vector/unsupported-operation`, no spawn) | live refusal, no process spawned |
| `--connect ADDR` (unauthenticated TCP control) | Never emitted | `buildVectorArgs` output contains no `--connect` |
| OUT-may-not-equal-IN without `--replace-lossy` | Enforced pre-spawn (`vector/invalid-input`) | live refusal |

## Live exercise through the committed adapter (2026-10-14)

Harness: throwaway Node script importing
`packages/editor-adapters/src/vector-adapter.ts` at main HEAD, confined
root `mkdtemp`, config `{ enabled: true, executablePath: <binary>,
rootDir: <root>, versionPin: VECTORCRAFT_PIN }`, requestor
`{ actorId: "qualify", workspaceId: "qualify" }`. No test files changed;
the committed fixture suite is untouched.

- `vectorAvailability`: `{ available: true, reason: "ready" }`.
- `commands`: valid JSON, 732 catalogue entries.
- Reference input: Skelet-owned `tokensToSvg` output (2 colors, sizes,
  spacing, radius) written as `in.svg`.
- `info in.svg`: valid JSON with keys `artboards, file, fonts, info,
  kinds, warnings`.
- `convert in.svg out.svg`: exit 0, 615 bytes, SHA-256
  `08b7d7bdaec4958548b94d2a3296f038c9143bfdf9aabd4c1f50daac1a2dac28`.
  Output passes the adapter's own `validateSvgOutput` and `inspectSvg`
  (344x120, 7 shapes).
- `convert` argv for `{ scale: 2 }`: `["convert", A, B, "--scale", "2"]`,
  matching the upstream usage line.
- Refusals without spawn: `run` and `bench` answer
  `vector/unsupported-operation`; same-file convert without
  `replaceLossy` answers `vector/invalid-input`.

## Scope and limits (honest)

- Qualified: allowlisted `convert`/`info`/`commands` argv shapes,
  JSON_parseability, SVG round-trip reopen validation, refusal paths,
  and timeout/output-cap plumbing as exercised above, at this exact
  commit on macOS arm64 with this toolchain.
- NOT qualified: `run`/`mcp`/`bench`/`perf` behavior (deliberately
  uninvoked), Windows/Linux binaries, other commits, GPU paths (the
  adapter rejects GPU/cloud operation by design), or production
  deployment of the binary (operator-installed, opt-in, confined).
- Fixture executables in `vector-adapter.test.mjs` remain the CI story:
  CI has no upstream binary and must never download one silently. This
  document is the upstream-compatibility evidence; fixtures are the
  regression story. Both statements stay true together.
- PhotoCraft genuine-binary qualification is a separate follow-on grain
  (build in progress at authoring time); this record covers VectorCraft only.

## Disposition

Issue #62 journey (c) — reference pack to permissioned editable SVG via
headless VectorCraft back into Skelet assets — is verified end to end
at the adapter-contract level against the genuine binary for the
`tokensToSvg` path. The AF-10 adapter's fixture-boundary note now
points here; fixture success plus this record together constitute the
AC-03 VectorCraft evidence.
