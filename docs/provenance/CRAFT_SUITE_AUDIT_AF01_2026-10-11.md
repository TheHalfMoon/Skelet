# Craft Suite Immutable Donor Audit (AF-01)

Grain: AF-01.
Base: `d07a8ea0b5073a4dda205a797084d2af3f730ba8`.
Branch: `skelet/af01-craft-audit`.
Verification date: 2026-10-11.
Method: `git ls-remote HEAD` plus GitHub contents API at the pinned commit.
Status: source-only audit. No runtime donor code is imported. No independent reimplementation. No new paid service.

Parent contracts: `docs/IMPLEMENTATION_PLAN.md` sections 12, 13, 16, 24; `docs/architecture/AGENT_FIRST_ZERO_FOUNDER_COST_BLUEPRINT_2026-10-11.md` sections 6, 8, 12; issue #62; execution frontier #34; `CODE_PROVENANCE.md`; `DATA_PROVENANCE.md`; `GOVERNANCE.md`.

Authorization: `docs/provenance/authorizations/craft-suite-2026-10-11.json`. The founder confirms that all previously authorized donor source code may be copied, modified, integrated, and rebranded into Skelet. This audit preserves applicable legal notices and distinguishes code rights from third-party asset rights.

Frozen evidence: `imports/craft-suite/donor-pins.json`, `imports/craft-suite/manifest.json`.

## 1. Source and permission matrix

All commits below were observed via `git ls-remote https://github.com/<repo>.git HEAD` on 2026-10-11 and cross-checked with the GitHub commits API. Trees were observed via the commits API.

| Donor | Pinned commit | Tree | License verified | Permission basis | Role | Status after AF-01 |
|---|---|---|---|---|---|---|
| `https://github.com/storytold/artcraft` | `28a39a0de4a2fc2eccc237df2046c24245bd12ab` | `fea600155ae05c6a4c367b8fc98ce152e0c30196` | MIT OR Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`) | founder authorization plus upstream license | transplant (selective) | ready |
| `https://github.com/storytold/artcraft-services` | `02a3de2509662cfc7c12f51c09e7f4322618029a` | `514284a65233a28620cfaf8eb69fdf45ce2a5de8` | Fair Source WIP (`LICENSE.md` restrictive; not an open-source grant) | founder authorization only for narrow code paths | transplant (narrow) | ready |
| `https://github.com/storytold/vectorcraft` | `6c3f9f60aa69ac151f9908b94cf00a387746eea4` | `35f2a36fe76bef9a810bf77cd66f5738a516a693` | MIT OR Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`) | founder authorization plus upstream license | adapter (headless only) | ready |
| `https://github.com/storytold/photocraft` | `97136485f0743251ab330d096ca6c9d0f0f6f54c` | `484b12daeb9e99b38d37545737dbeccb6ff127cc` | MIT OR Apache-2.0 | founder authorization plus upstream license | adapter (headless only) | ready |
| `https://github.com/storytold/designcraft` | `16a7365701f9ce8f93ca77a27a8dc2fffb807869` | `f102022e5ed9c6f9bb990731d8346d4b08fdeb8f` | MIT OR Apache-2.0 | founder authorization plus upstream license | adapter (post-launch evaluate) | ready |
| `https://github.com/storytold/effectcraft` | `9a7d3e76991d5372448033b473dc12c2480a6a04` | `8271189ed4c16fdccc1cecbe556b77ee99b3ebfa` | MIT OR Apache-2.0 | founder authorization plus upstream license | adapter (post-launch evaluate) | ready |
| `https://github.com/storytold/filmcraft` | `4e2d0bc2d3646f9cf27ef7aa8b2095c6858c7efe` | `d951dfcfdc344f0e7f78aeb54df380e29d56001b` | MIT OR Apache-2.0 | founder authorization plus upstream license | adapter (deferred) | ready |
| `https://github.com/storytold/lightcraft` | `0ba118de92a81f7463ca0e6d79e1323137b1adae` | `7657bd036f8eaa7c7e94268b2846dca4ae90a961` | MIT OR Apache-2.0 with `crates/segment` Apache-2.0-only exception | founder authorization plus upstream license | adapter (deferred) | ready |

License file blob identities are frozen in `imports/craft-suite/donor-pins.json`. Key observations:

- ArtCraft dual license text: `LICENSE-MIT` 1100 bytes, `LICENSE-APACHE` 10174 bytes, `NOTICE` 2996 bytes. Copyright 2026 ArtCraft Team and contributors. Name, wordmark, and logos are trademarks and are not covered by the code license.
- ArtCraft-services `LICENSE.md` 4969 bytes is an explicit Fair Source WIP document with commercial-sale, competing-product, fork-link-removal, and brand-use restrictions. Reuse of its frame-extractor code relies solely on the founder authorization record, never on an assumed open-source grant.
- VectorCraft, PhotoCraft, DesignCraft, EffectCraft, FilmCraft, and LightCraft each carry `LICENSE-MIT` (1101 to 1103 bytes), `LICENSE-APACHE` (10174 bytes), and a `NOTICE` (907 to 4375 bytes). Workspace `Cargo.toml` files declare `license = "MIT OR Apache-2.0"`.
- LightCraft exception: `crates/segment` ports Hugging Face Transformers SAM3 code and is Apache-2.0-only. SAM3 weights, RawNIND checkpoints, and AI denoise weights are never distributed with the donor and require separate user-accepted terms. Skelet must never bundle them.
- All six Rust donors reference `https://github.com/storytold/craft-libs` (VectorCraft pins `rev = "5c874d51eeb3de70e735c8ce87a59a7dedd47675"` in workspace dependencies) and `https://github.com/storytold/craft-fonts` attribution. Those are separate sources and are not activated by AF-01.

## 2. Actual source verification

Candidate paths from issue #62 were verified to exist at the pinned commits:

- ArtCraft `frontend/libs/components/moodboard/`: `package.json`, `src`, `src/lib/adapter.ts`, `src/lib/boards/`, `src/lib/canvas/`, `src/lib/grid/`, `src/lib/persistence/`, `src/lib/galleryDrop.ts`, `src/lib/MoodboardWorkspace.tsx`. Verified board files include `BoardLibraryStore.ts` (20269 bytes), `moodboardSync.ts` (20841 bytes), `documents.ts` (7524 bytes), `MoodboardWorkspace.tsx` (7608 bytes), `adapter.ts` (3423 bytes).
- ArtCraft-services `frontend/apps/artcraft-webapp/src/pages/frame-extractor/lib/`: `extract-frames.ts` (8091 bytes) and `frame-actions.ts` (3246 bytes). Both exist.
- ArtCraft `frontend/libs/components/pagedraw/`: `package.json`, `src`, `src/lib/adapter.ts` (1968 bytes), `Node.ts`, `types.ts`, `HistoryStack.tsx`, `PageDraw.tsx`, `PaintSurface.tsx`, `stores/`, `utilities/`, `hooks/`, `PromptEditor/`.
- ArtCraft `frontend/libs/components/pagescene/`: exists (`AGENTS.md`, `CLAUDE.md`, `package.json`, `src`). Rejected from core by this audit.
- VectorCraft `apps/vectorcraft-cli/` (`Cargo.toml`, `src`, `tests`), `crates/mcp/` (`Cargo.toml`, `src`, `tests`), `docs/mcp.md` (244842 bytes). All exist.
- PhotoCraft `apps/photocraft-cli/` (`Cargo.toml`, `build.rs`, `src`, `tests`), `crates/automation/` (`Cargo.toml`, `src`, `tests`). All exist.
- DesignCraft `apps/designcraft-cli/` (`Cargo.toml`, `src`, `tests`), `crates/mcp`. Exists.
- EffectCraft `crates/lottie/`, `crates/export`. Exists.
- FilmCraft root workspace exists (`apps/`, `crates/`, `docs/`). No `docs/mcp.md`; deferred ingest helpers only.
- LightCraft `Cargo.toml`, `docs/mcp.md` (17591 bytes). Exists.

Equivalence note: issue #62 reports 8 sampled library blobs match exactly between ArtCraft and ArtCraft-services. AF-01 freezes the ArtCraft SHAs above as the authoritative dual-licensed source and does not presume whole-tree equivalence. Any services-only file must prove exact blob equality again at import time.

## 3. Code rights versus third-party asset rights

Code reuse is authorized for paths admitted by `imports/craft-suite/manifest.json` only. The following remain restricted and are quarantined by prefix:

- `frontend/apps/artcraft/app/public/resources/sound/`: Nintendo game sounds (Golden Sun, Metroid Prime, Zelda Ocarina of Time, Mario RPG).
- `frontend/apps/artcraft/app/public/resources/memes/`: meme images and likenesses.
- `frontend/apps/artcraft/app/public/resources/skybox/gray/` and `skybox/night/`: third-party skybox pack.
- `frontend/apps/artcraft/app/public/resources/pose/Lumine Idle cycle.vmd`: third-party MMD motion data.
- `frontend/apps/artcraft/app/public/resources/characters_gif/`: Mixamo animation renders.
- `frontend/apps/artcraft/app/public/resources/images/services/`: AI provider and service logos (trademarks of respective owners).
- Fonts under SIL OFL 1.1: Carter One, Inter, Archivo, Geist Mono, Source Sans 3, Source Serif 4, JetBrains Mono, Noto Serif, BIZ UDPGothic, Shippori Mincho, BIZ UDMincho, Noto Sans CJK SC, Noto Sans Arabic. License texts ship beside the fonts and in release packages.
- Icons: Font Awesome Free under CC BY 4.0 (ArtCraft brand-icons and generic service SVG); Lucide icons under ISC (plus MIT for Feather-derived icons); DesignCraft UI icons are original work; all other brand marks excluded.
- Text data: SCOWL English word list under its own license; Moby hyphenation list (public domain) plus trained CC0 patterns; Spanish hyphenation under MIT via hypher crate.
- Decoders and maps: Adobe CMap resources under BSD-3-Clause via hayro-cmap; jpeg-encoder under MIT/Apache plus IJG terms; wasmi under MIT/Apache plus wasmparser under Apache with LLVM exception.
- `normalize.css` MIT (Nicolas Gallagher and Jonathan Neal); `three-dots` MIT (nzbin); `tauri-plugin-http` vendored fork under MIT/Apache; ammo.js under zlib.
- `docs/brand/` plus `docs/brand/LICENSE-brand.txt`: ArtCraft name, wordmark, and logos are trademarks, not open source.
- `docs/images/`: public-domain film and NASA frames plus CC0 music where stated; Ansel Adams, Dorothea Lange, and NASA showcase photos where stated; each requires per-file attribution checks before redistribution.
- Models and weights: ArtCraft paid models; LightCraft SAM3 checkpoint under Meta SAM License; RawNIND UtNet2 Bayer checkpoint under GPL-3.0 optional offer; `lib/ml/model.onnx` plus `onnxruntime-node` where present. None are granted by the code authorization.
- Services and credentials: ArtCraft API, paywalled media, gallery subscriptions, launcher downloads, telemetry, model SDKs, DNS update checks, donor endpoints. None may become mandatory Skelet dependencies.
- `crates/vendor/tauri-plugin-http/` and `vendor/windows-link/` carry their own license texts.

Preserve `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`, `ATTRIBUTION.md`, `ASSETS.md`, `assets/icons/LICENSE-lucide.txt`, `assets/fonts/OFL-*.txt`, `assets/dict/LICENSE-SCOWL.txt`, and `docs/brand/LICENSE-brand.txt` for any copied source. Never rewrite third-party identifiers, copyright notices, provenance URLs, or trademarks during rebranding. Only Skelet-owned project identity may be renamed.

## 4. Dependency inventory

### ArtCraft Moodboard (P12 candidate)

`frontend/libs/components/moodboard/package.json` declares no runtime dependencies (`@storyteller/ui-moodboard` 0.0.1, module only). Transitive platform seams observed in `adapter.ts`:

- `MoodboardReference`, `MoodboardPickedItem`, `RemoteBoardMeta`, `MoodboardPersistenceAdapter` (account-keyed `getUserId`, `subscribeAuthState`, `saveBoard`, `listBoards`, `loadBoard`, optional `deleteBoard` and `resolveMediaUrls`), and `MoodboardAdapter` (`uploadImage`, `sendToGeneration`, `renderLibraryPicker`, optional `persistence`).
- Board stores: `BoardLibraryStore.ts`, `boardSelectors.ts`, `boardTypes.ts`, `linkMeta.ts`, `measureMedia.ts`, `palette.ts`, `useBoardItemEntry.tsx`.
- Canvas: `Moodboard.tsx`, `MoodboardStage.tsx`, `MoodboardStore.ts`, `MoodboardHistoryStore.ts`, `MoodboardToolbar.tsx`, `FloatingToolbar.tsx`, `TextEditOverlay.tsx`, `addCanvasImageFile.ts`, `cardLayout.ts`, `canvasBridge.ts`, `interactions/`, `layout/`, `nodes/`, `overlays/`, `types.ts`, `useMoodboardImageEntry.tsx`, `useThemeFgRgb.ts`.
- Grid: `BoardCard.tsx`, `BoardGrid.tsx`, `BoardGridView.tsx`, `BoardGridToolbar.tsx`, `PresentationView.tsx`, `gridLayout.ts`, `useGalleryBoardDrop.ts`, plus inspector, picker, favicon, section header, selection bar, and smart search bar components.
- Persistence: `documents.ts`, `moodboardSync.ts`, `dirtySuppression.ts`, `canvasBridge.ts`.

React and Konva versions must be resolved from the Skelet app shell at transplant time. Tauri, hosted media, brand tokens, private datasets, and model-list provider calls are excluded. Client-only Next.js dynamic import, `@storyteller/*` alias mapping, keyboard focus, reduced motion, and mobile viewport are mandatory at AF-07/AF-08.

### ArtCraft-services frame extractor (P10 candidate)

`extract-frames.ts` is browser-only with zero npm runtime dependencies. Verified behavior from source reading:

- `captureFrameAt` and `extractFrames` seek an `HTMLVideoElement`, wait for presentation, draw to canvas, and encode PNG blobs. No server round-trips.
- Bounded timeouts: metadata 5000 ms, seek 3000 ms, paint wait 300 ms. Epsilon seek skip 0.001 s. Duration clamp avoids black end frames. Non-finite durations pass through.
- Cancellation via `AbortSignal` with `FrameExtractionError` kinds `cors`, `timeout`, `decode`, `aborted`. CORS `SecurityError` and null `toBlob` map to `cors`. Captured blobs are revoked on failure. Original playhead and play state are restored in `finally`.
- `objectUrl` ownership stays with the caller and must be revoked on discard.

Skelet must add frame count, time, and byte caps, deterministic timestamp labels, source video hash, and rights classification around this module. `frame-actions.ts` is optional and UI-coupled; it must not pull ArtCraft API or subscription code.

### ArtCraft PageDraw (P14 conditional)

Local primitives observed: `adapter.ts`, `Node.ts`, `types.ts`, `HistoryStack.tsx`, `JobContext.tsx`, `PageDraw.tsx`, `PaintSurface.tsx`, `BlankCanvasModal.tsx`, `stores/`, `utilities/`, `hooks/`, `components/`, `pagedraw.css`. `PromptEditor/` and generation components are excluded. Hosted generation calls and provider model lists must be replaced by a Skelet capability adapter. This transplant is conditional on proving VectorCraft and PhotoCraft adapters insufficient for the same local edit.

### VectorCraft headless (P14)

Workspace 0.9.0, Rust 1.95, edition 2024, `MIT OR Apache-2.0`, `unsafe_code = deny`, shipped code denies `unwrap`, `expect`, `panic`, `todo`, `unimplemented`, `unreachable`.

- `apps/vectorcraft-cli`: headless batch plus MCP server over stdio. Depends on vectorcraft color, doc, engine, format, geom, svg, mcp, render, text plus `serde_json` and `log`. Windows DirectWrite and macOS CoreText font integrations are platform-conditional.
- `crates/mcp`: JSON-RPC 2.0 over stdio driving a running app or headless session. Depends on engine, render, svg, format, tools, geom, doc plus `serde_json`, `log`, `image`. Dev-only `proptest` and `socket2`.
- Workspace externals are permissive: `kurbo`, `peniko`, `vello_cpu` with `f32_pipeline`, `image` (png, jpeg, webp, gif, tiff, bmp), `usvg`, `krilla`, `skrifa`, `harfrust`, `linesweeper`, `wasmi` (portable dispatch, validated modules), plus GUI-only `egui`/`eframe` which are excluded from the server path.

Skelet must run the CLI as an explicitly installed, pinned, sandboxed per-job process with allowlisted operations and confined read/write roots. The whole editor must never be vendored into Next.js. No unauthenticated TCP bridge and no unrestricted scripts.

### PhotoCraft headless (P14 optional)

- `apps/photocraft-cli`: headless convert, inspect, batch, and MCP server. Depends on automation, engine, io, format, codecs plus `serde_json` and `tokio` multi-thread. `build.rs` uses `winresource` on Windows only. Optional `heif` feature pulls `photocraft-heif` and stays off by default.
- `crates/automation`: MCP server over `rmcp` 3.5 plus bridge to a running GUI. Depends on geom, doc, compose, codecs, io, format, engine plus `serde`, `serde_json`, `thiserror`, `tokio` (rt, macros, io, sync, net, time), `base64`, `schemars`, `getrandom`, `cap-std`.

Skelet must sandbox each job with explicit roots, CPU/memory/time limits, idempotent output registration, and no ambient network. GPU and cloud requirements are rejected. HEIF needs a separate rights review before enablement.

### DesignCraft, EffectCraft, FilmCraft, LightCraft (post-launch or deferred)

- DesignCraft CLI plus MCP: document/export adapter candidate. Post-launch only. GUI and brand assets excluded.
- EffectCraft `crates/lottie` plus `crates/export`: Lottie and motion export candidate. Post-launch only. Bulky runtimes excluded from launch.
- FilmCraft ingest, frames, and timeline helpers: only if P10 recording import shows a quantified gap. Full film studio excluded.
- LightCraft image metadata and analysis: only if the Skelet image pipeline lacks the capability. RAW decoders, `crates/segment` (Apache-only SAM3 port), SAM weights (Meta license), RawNIND checkpoints (GPL-3.0 optional), and GPU paths are excluded from launch.

## 5. Precise import manifests

The binding manifests live in `imports/craft-suite/manifest.json`. Summary:

- P10 video frame capture: include `extract-frames.ts`; optional `frame-actions.ts`; exclude extractor components, API, gallery, and subscription prefixes; reject ArtCraft API, paywalled media, subscriptions, server round-trips, and model services.
- P12 reference board core: include board, canvas, grid, and persistence prefixes plus `adapter.ts`, `MoodboardWorkspace.tsx`, `galleryDrop.ts`, and `package.json`; exclude ArtCraft apps, native shell, smart search bar generation path, Rust crates, pagescene, and video editor; reject cloud sync, hosted media, brand tokens, private datasets, model lists, provider tokens, and Tauri APIs.
- P14 PageDraw primitives: include stores, utilities, hooks prefixes plus adapter, node, types, history, draw, and paint files; exclude prompt editor and generation components; reject hosted endpoints, provider tokens, model lists, and paid inference.
- P14 VectorCraft headless: include CLI and MCP Cargo files, mains, sources, tests, workspace `Cargo.toml`, and `docs/mcp.md`; exclude desktop app, `ui-egui`, `testkit`, `assets/`, `docs/brand/`, and `packaging/`; reject whole-editor vendoring, TCP control, unrestricted scripts, GUI crates in server path, and font-embedded builds without OFL records.
- P14 PhotoCraft headless: include CLI Cargo, main, lib, automation Cargo, sources, tests, and workspace `Cargo.toml`; exclude GUI app, `assets/`, `docs/brand/`, and `packaging/`; reject GPU/cloud, arbitrary shell, default HEIF, and GUI vendoring.
- Post-launch: DesignCraft CLI/MCP and EffectCraft lottie/export are optional handoffs; FilmCraft and LightCraft are deferred to benchmark-justified helpers.
- Rejected from core: `pagescene/`, `video-editor/`, ArtCraft apps and native shell, and all ArtCraft-services API, server, subscription, billing, and model marketplace paths.

## 6. Strongest reusable implementations

- P10: `extract-frames.ts` (`captureFrameAt` plus `extractFrames`). Strongest because it is dependency-free, cancellable, CORS-aware, restores player state, and maps every failure to a typed `FrameExtractionError`.
- P12: ArtCraft Moodboard board model plus `BoardLibraryStore`, `documents.ts`, `moodboardSync.ts`, virtualized grid, Konva canvas, `PresentationView`, history, selection, grouping, snap, and serialization. Strongest because no other donor offers a mature board system with account-keyed sync, dirty suppression, canvas bridge, and offline draft handling.
- P14 vector: `vectorcraft-cli` headless batch plus `vectorcraft-mcp` stdio server. Strongest vector path because of the purpose-built CLI/MCP surface, deny-unsafe lints, and SVG/format/render crates.
- P14 raster: `photocraft-cli` convert plus `photocraft-automation` MCP bridge. Strongest raster path because it exposes deterministic convert and automation without the full Photoshop-class GUI.
- P14 local 2D fallback: PageDraw layers, masks, history stack, and paint surface. Conditional only.
- Post-launch: DesignCraft document layouts and EffectCraft Lottie export. Deferred FilmCraft timeline and LightCraft metadata helpers.

## 7. Skelet architecture stays authoritative

Skelet PostgreSQL, canonical graph, storage, providers, auth, quota, MCP/REST, and rights stay authoritative. Specific bindings:

- `Collection` is canonical. Boards are versioned layout projections keyed by existing collection IDs with stable artifact URIs, positions, grouping, zoom, revision, optimistic CAS, content hash, and tombstones. No alternate board database.
- `getArtifactForActor` (AF-SEC-00) gates every retrieval, search, resolve, pack export, save, preview, cache, and editor handoff. Layout cards may reference only existing canonical artifact URIs.
- Restricted, trademarked, or unknown-license bytes never enter ZIPs, packs, boards, or registries. Takedown purges derivatives, thumbnails, caches, and search entries.
- Every exported claim is labeled observed, deterministic computation, heuristic inference, generated-by-external-agent, or unknown. Frames never fabricate click paths or UX interactions.
- No MySQL, Redis, or Elasticsearch transplant. No second search contract. PostgreSQL full-text search plus deterministic facets and fingerprints are the launch baseline; embeddings are an optional customer-installed plugin, never a mandatory prerequisite.
- No mandatory paid AI API, GPU hosting, paid cloud service, or founder-funded customer workload. Local and customer self-hosted modes run with no model key, no GPU, and no paid cloud subscription. Public URL capture contacts only the authorized target site, never a paid model service.

## 8. Performance caps set by AF-01

AF-01 sets caps for later regression gates; it makes no performance claim:

- Board layout JSON 524288 bytes; board nodes 2000; board depth 8.
- Video frames per job 24; video frame bytes 8388608; video job seconds 120.
- Editor job seconds 300; editor memory 1024 MB; editor CPU seconds 240.

Later grains must measure payload, build size, cold load, board interaction, and import latency on constrained local hardware and roll back on regression.

## 9. Dependency and CVE posture at AF-01

- No npm, Cargo, model, service, or credential dependency is added by AF-01. The grain is docs, lock, manifests, and tests only.
- Moodboard has no package runtime dependencies; React and Konva versions resolve at transplant time and must be scanned then.
- Frame extractor has no npm runtime dependencies.
- Rust externals listed in section 4 are observed, not vendored. Full `cargo audit` with pinned lockfiles is required at AF-10 and AF-11 before any binary is accepted. GUI-only crates (`egui`, `eframe`, `ui-egui`) are excluded from server paths.
- `craft-libs` rev `5c874d51eeb3de70e735c8ce87a59a7dedd47675` and `craft-fonts` attribution are separate sources and are not activated here.

## 10. What AF-01 proves and what it does not

Proves:

- All eight craft donors exist, are reachable, and are pinned to immutable commits and trees.
- Upstream licenses and NOTICE files are identified with blob SHAs and sizes.
- Candidate source paths exist at those pins for P10, P12, and P14.
- Code rights are separated from data, asset, model, service, and trademark rights with quarantine prefixes.
- Precise include and exclude manifests exist for every future import.
- The strongest reusable implementation is named for each phase.
- No runtime code, paid dependency, GPU, or cloud workload is introduced.

Does not prove:

- Transplant correctness, UI integration, sandboxing, MCP wiring, search ranking, Build Kit closeout, video end-to-end, board collaboration, or editor execution. Those belong to AF-02 through AF-12 and the remaining P09b grains.
- Whole-tree ArtCraft versus ArtCraft-services equivalence beyond the frozen key-file SHAs.
- Future donor HEADs. Every later copy must re-verify the then-current immutable pin immediately before copying.

## 11. Next executable grains

AF-02 zero-model and egress conformance may proceed in parallel as planning and security work, but must never merge overlapping public contracts with in-flight P09b. AF-06 starts only when P10 is opened. AF-07 and AF-08 start only when P12 is opened. AF-10 and AF-11 start only after the P14 entry gate with P08 through P12 stable. Remaining P09b acceptance stays launch-critical and must not be hijacked by craft imports.

English only for every communication, commit, PR, document, review, and report.
