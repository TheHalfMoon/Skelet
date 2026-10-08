# G01-02c — Monet Dependency Closure and Quarantine Resolution

Status: candidate for exact-HEAD review; analysis only, no donor code copied.

## Method

All 45 `code_candidates` from `docs/provenance/monet-code-snapshot-audit.json`
were fetched at the pinned commit
`monet-design/monet-registry@85c966f8d94572431bcbb4439f9fd7ea2a893321`
via the Git blob API. Each blob was verified by SHA-1 over
`blob <len>\0<content>` against `imports/monet-registry/source-tree.tsv`:
**45/45 verified**. Static `import`/`require`/`export-from` (and CSS
`@import`) edges were extracted per file and classified as `node-builtin`,
`npm-external`, `relative-sibling`, `candidate-internal`, or
`non-candidate-internal`. Machine-readable result:
`imports/monet-registry/dependency-closure.json`.

## Decisions

| Decision | Files | Meaning |
| --- | --- | --- |
| transplanted | `scripts/screenshot/queue.ts` | Zero imports; closed. Done in G01-02b (PR #7). |
| selected-next | `src/lib/utils.ts` | Pure `cn()` helper (`clsx` + `tailwind-merge`); no corpus coupling. The single G01-03b transplant candidate. |
| rejected | `scripts/screenshot/reset.ts`, `src/hooks/use-toast.ts` | Destructive op on the excluded corpus path; dependency on excluded `src/components/ui/toast`. Never transplant. |
| reference-only | remaining 41 | See per-file reasons in the closure JSON. |

## Module notes (screenshot capture chain)

`queue.ts` is closed. `state.ts` (node builtins only) stays out: its state
file is donor-path-coupled. `reset.ts` is rejected (deletes PNGs under the
excluded corpus path). `browser.ts` requires `puppeteer`, hardcodes
`http://localhost:3000`, and launches Chromium with `--no-sandbox`:
incompatible with Skelet worker isolation and SSRF policy, reference only.
`screenshot.ts` writes into excluded `public/registry/preview` with hardcoded
donor URLs; only its `{success, id, path, error}` envelope shape is reusable.
`cli.ts` (not a candidate) requires excluded `public/generated/registry.json`;
its orchestration flow is reference for the future Skelet capture worker.

## API routes and e2e

All 13 API routes import `@/app/api/_common/services|types|utils`, which are
outside the candidate set, and `code-reader.service.ts` carries the recorded
excluded-corpus edge into `src/components/registry/`. They are not
dependency-closed: reference only (response envelope and error-format
shapes inform Skelet REST design).

Transitive verification (`non_candidate_context`, 14/14 blobs verified,
read-only): `code-reader.service.ts` dynamically imports
`@/components/registry/${componentId}`, so every route reaching the services
barrel transitively reaches the excluded corpus. `page-search`/`search`
services additionally require `@orama/orama`; registry services are
Next-runtime coupled (`fs/promises`, `next/cache`). Only the leaf modules
`types/responses.ts`, `utils/constants.ts`, and `utils/errors.ts` are
corpus-free, reusable solely via direct leaf imports that bypass the
`_common` barrels. No non-candidate bytes were copied. The 17 e2e files require a running donor
application: reference only for Skelet-owned contract tests.

## Rejected auth pattern

`src/middleware.ts` fails OPEN when `API_BASIC_AUTH_USER`/`PASSWORD` are
unset. It is reference only and MUST NOT be copied: Skelet authentication
fails closed (`SECURITY.md`).

## License and runtime surface

No per-file license header exists in any of the 45 candidates, and the donor
tree contains no `LICENSE`/`NOTICE`/`COPYING`/`COPYRIGHT` file (see manifest
`rights_gate`). Copying rests solely on the recorded code-only founder
authorization (`upstream_license_status=not_verified`); every transplant grain
must re-assert that basis and preserve attribution. Each closure entry records
`license_header` plus a static `runtime_surface` (`env_reads`,
`network_refs`, `fs_writes`, `fs_reads`, `process_control`,
`server_or_browser`). Each entry also records `excluded_refs`: string literals
pointing at excluded or rejected paths (e.g. `reset.ts` references the
excluded corpus dir `public/registry/preview`; `state.ts` references the
rejected `screenshot-state.json`; the e2e pages test references
`src/components/pages`). Notable findings: the e2e harness targets
`http://localhost:4413` with Basic-auth env credentials; `reset.ts` deletes
files (`unlinkSync`); `state.ts` writes its state file; `middleware.ts`
reads auth env. These facts reinforce the reference-only/rejected decisions
above and constrain future transplant grains.

Donor-pinned external versions (from the pinned `pnpm-lock.yaml` candidate)
are recorded under `external_pins` for drift detection: `clsx 2.1.1`,
`tailwind-merge 2.6.0` (the G01-03b pair), `typescript 5.9.3`, `next 15.1.9`,
`puppeteer 24.31.0`. `playwright` is absent from the donor tree, confirming
it as a Skelet-side choice rather than donor inheritance. Transplant grains
re-pin independently.

## Quarantine

All four quarantine prefixes (`agent-input/`, `data/`, `public/`,
`src/components/registry/`) and all 45 quarantined files remain fully
excluded. **Nothing was unquarantined in this grain.**

## Selection rule for future grains

Each future transplant must prove dependency closure the same way before
copying: every edge resolves to a node builtin, a pinned npm external, or an
already-transplanted Skelet-owned path. Excluded-prefix edges must be
decoupled or the file stays out.
