# AC-01 Video-Frame Adopt-vs-Keep Decision — KEEP Skelet-Owned (Measured)

Status: DECISION RECORD with machine-checked measurements. Base: `a4cd2eb` (PR #108 merge).
Scope: compare the Skelet-owned bounded video-frame evidence engine
(`packages/lens/src/video-frame-evidence.ts` + `jpeg-evidence.ts`,
qualified in AF-06-i/ii) against the ArtCraft P10 candidate
`extract-frames.ts` (inventoried in AC-00-ii at pinned artcraft-services
commit `02a3de2`). No code transplanted by this grain. Every static
fact cited below is asserted offline by
`tests/test_ac01_frame_decision.py`; CI never touches the network.

## 1. What was measured (all values extracted, none hand-typed)

| Dimension | Skelet-owned engine | Donor `extract-frames.ts` |
|---|---|---|
| Runtime imports | 0 (`node:crypto` + local `jpeg-evidence.ts` only) | 0 (fully self-contained) |
| Source size | 323 + 89 lines | 8091 bytes, 1 file |
| Operating layer | Server-side evidence mapping over caller-supplied decoded frames; no video decoding, no DOM | Browser-side capture: seek `<video>`, draw to canvas, PNG blob |
| Frame-count cap | 64 (`VIDEO_FRAME_BUDGET.maxFrames`) | none (caller `count` unbounded) |
| Byte caps | 8 MiB/frame, 16 Mpx area, 4096 side | none (full-resolution canvas) |
| Duration/fps agreement | fps x duration self-consistency enforced, 120 fps / 600 s ceilings | none |
| Timestamp determinism | Integer index-to-ms mapping, digest-bound, re-authenticated | Float seconds from caller; epsilon seek-skip; playhead restore |
| Cancellation | Synchronous pure mapping (nothing to cancel); cancel lives at the job lifecycle | `AbortSignal` mid-burst (partial frames lost, URLs revoked) |
| Error taxonomy | `video-frame/invalid-spec`, `over-budget`, `corrupt-frame` | `cors`, `timeout`, `decode`, `aborted` |
| Timeouts | n/a (no I/O) | 5000 ms metadata, 3000 ms seek, 300 ms paint wait |
| Output encoding | JPEG-only ingress (`inspectJpeg` requires `FFD8`) | PNG-only egress (`canvas.toBlob(..., "image/png")`) |
| Provenance/rights | Source-hash binding, evidence digest, re-validation, rights classification downstream | none (caller-owned blob URL, randomUUID id) |
| SSR safety | server-safe (no DOM at import or call time) | client-only (`document.createElement`, video/canvas APIs) |

## 2. Verdict: KEEP Skelet-owned, adopt nothing

1. **No dependency win.** Both sides are dependency-free; transplanting buys zero integration simplicity.
2. **Skelet bounds strictly more.** The donor caps nothing: unbounded frame counts at full video resolution with caller-controlled spacing. Skelet enforces count/byte/area/fps/duration agreement. Adopting the donor as-is would weaken the AF-06 resource posture.
3. **Skelet timestamps are the deterministic ones.** Integer mapping plus digest binding and re-authentication beats float-second seek targets for evidence purposes.
4. **Format incompatibility.** The donor emits PNG; Skelet ingress validates JPEG structure. A transplant would additionally require a PNG validation path or a conversion step — scope creep with its own review surface.
5. **Layer mismatch with real cost.** The donor needs a `<video>` element and DOM at call time. Skelet web/worker are SSR/server surfaces with no browser capture worker in the qualified architecture; admitting one would add isolation/SSR review surface for a journey (video to timestamped artifacts/flow) already exercisable through the mapping layer with caller-supplied frames.
6. **Cancellation and errors are covered at their own layers.** Abort semantics live in Skelet's job lifecycle; evidence mapping is pure and needs none. Both taxonomies fail closed; neither fills a gap in the other.

## 3. Revisit trigger (not a deferral of required work)

If a browser-side video capture surface is ever scoped, `extract-frames.ts`
is the pinned, SHA-verified, zero-import candidate (see AC-00-ii closure),
to be wrapped with Skelet budgets, JPEG/PNG ingress parity, provenance,
and rights before use. Likewise, if PNG frame ingress is ever scoped for
the evidence layer, re-evaluate §4 rather than citing this decision as a
block. No action until such a surface is in the plan.
