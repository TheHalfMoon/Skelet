# OpenPencil Adapter Evaluation (P14 Entry)

Date: 2026-10-15.
Upstream: https://github.com/open-pencil/open-pencil.
Pinned commit: `78355fd3890cc9da9539235ee3b38beb917f2ed6` (verified HEAD via
`git ls-remote` at evaluation time; shallow clone confirms the same SHA).
Version at pin: 0.16.0. License: MIT (verified via GitHub API and the LICENSE
file at the pinned commit: "Copyright (c) 2026 Danila Poyarkov and OpenPencil
contributors"). No source code was imported in this grain.

## What was inspected

- `package.json`: bun-first monorepo (`packageManager bun@1.4.2`, no Node
  engines field), ~30 workspaces. Skelet is pnpm/Node: any runtime use
  must cross that toolchain boundary through a built artifact or a
  subprocess, never a shared install.
- `packages/mcp` (`@open-pencil/mcp` 0.16.0, MIT): MCP server with stdio
  (`openpencil-mcp`) and HTTP (`openpencil-mcp-http`) transports, tool
  registration/scope/policy, sessions, and auth. Live-document tools
  bridge to the OpenPencil DESKTOP app over WebSocket (`browser-rpc.ts`,
  20 s RPC timeout, 10 s app-wait): without a running desktop app with an
  open document, those tools answer APP_NOT_CONNECTED by design.
- `packages/cli` (`openpencil` bin): headless commands including `tree`,
  `node`, `query` (XPath), `info`, `export` (PNG/JPG/WEBP/SVG/PDF/PPTX/
  HTML/JSX/Storybook/`.fig`), `convert`, `documents`, `import`, `diff`,
  `tokens`, `fonts`, `formats`, `history`, `find`. Deps include
  `canvaskit-wasm` (WASM payload weight) and workspace `@open-pencil/*`
  packages.
- `packages/fig` (`@open-pencil/fig` 0.16.0, MIT, `sideEffects: false`):
  native `.fig` read/write library. `packages/pen`: `.pen` documents.
- `desktop/`: Tauri app (Cargo.toml, capabilities, entitlements). Desktop
  distribution is out of scope for Skelet's server surfaces.

## Compatibility verdict

The **headless CLI plus the fig/pen libraries** are the P14-compatible
surface: they match the plan's "headless command adapter with restricted
read/write roots" shape and the `.fig`/`.pen` exit criterion. The **MCP
server's app-bridged tools and the Tauri desktop are rejected** as
integration paths: they require a running desktop app with an open
document over WebSocket, which has no place in Skelet's worker/web
runtime and would couple agent operations to a GUI session.

## Reuse shortlist (adapter-first, no vendoring)

1. Headless `openpencil` CLI behind a Skelet-owned adapter: allowlisted
   document commands (`tree`/`node`/`query`/`info`/`export`/`convert`)
   with explicit read/write roots, scrubbed env, CPU/memory/time limits,
   and idempotent output registration — the same confinement contract as
   the VectorCraft/PhotoCraft adapters (AF-10/11).
2. `@open-pencil/fig` for `.fig` fidelity checks where the CLI surface
   proves insufficient. Library use stays behind the adapter; no
   workspace dependency enters Skelet's install.
3. Reference-pack to OpenPencil document flow stays a future grain: this
   evaluation qualifies the upstream, it does not implement the journey.

Skelet's canonical graph, storage, auth, quota, MCP/REST, and rights stay
authoritative throughout; OpenPencil owns edit/canvas behind the adapter.

## Version and rights flags for any future adapter grain

- Bun-first toolchain vs Skelet pnpm/Node: adapter must spawn a built
  artifact or subprocess; never share an install or lockfile.
- `canvaskit-wasm` weight and CPU cost must be budgeted per-job like any
  other headless binary; no ambient WASM in web/worker bundles.
- Desktop app, Tauri updater, and app-bridged MCP tools are out of scope
  for server use; auth tokens for any bridge must never enter logs.
- `.fig`/`.pen` round-trip fidelity needs its own fixture proof before
  any export claim (mirrors the VectorCraft/PhotoCraft genuine-binary
  qualification precedent).
