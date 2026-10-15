# AC-04 Post-Launch Evaluation Disposition — DEFER All Five (Measured)

Status: DISPOSITION RECORD with machine-checked traceability. Base: `11b84c5` (PR #110 merge).
Scope: explicit accept/defer verdicts for the five post-launch
candidates from Issue #62 (DesignCraft, EffectCraft, FilmCraft,
LightCraft, PageScene/video-editor). Every candidate is DEFERRED with a
measured trigger. No code, config, or dependency changed by this grain.
Traceability is asserted offline by `tests/test_ac04_post_launch.py`;
CI never touches the network.

## Verdicts (all DEFER, none launch-blocking)

| Candidate | Pinned source | Verdict | Trigger to re-evaluate |
|---|---|---|---|
| DesignCraft document layouts | `designcraft` @ `16a7365` (MIT OR Apache-2.0) | DEFER | OpenPencil adapter scoping compares pack-to-document options; adopt only behind the tested adapter boundary |
| EffectCraft Lottie/motion export | `effectcraft` @ `9a7d3e7` (MIT OR Apache-2.0) | DEFER | Benchmark-justified motion-export need with unsupported-feature diagnostics requirement |
| FilmCraft ingest/frames/timeline | `filmcraft` @ `4e2d0bc` (MIT OR Apache-2.0) | DEFER | Quantified gap in P10 recording import (Skelet frame mapping qualified, no gap measured) |
| LightCraft media metadata | `lightcraft` @ `0ba118d` (MIT OR Apache-2.0; `crates/segment` Apache-2.0-only) | DEFER | Demonstrated lack in the Skelet image pipeline (JPEG inspect, tokens, OCR path qualified) |
| PageScene 3D + video-editor | `artcraft` paths `pagescene/`, `video-editor/` (rejected-from-core) | DEFER | Never launch-critical; full 3D/video-editor would invert the modular monolith |

## Why deferral is the evidence-backed disposition

1. **No measured gap.** No qualified journey requires document layouts,
   Lottie export, ingest timelines, RAW/segment metadata, 3D scenes, or
   a video editor. P10 frame mapping, the image pipeline, and the board
   are qualified without them.
2. **No mandatory dependency.** The manifest scopes all five as
   post-launch-evaluate or rejected-from-core; the plan forbids making
   launch wait on them.
3. **Rights boundaries preserved.** LightCraft `crates/segment`
   (Apache-2.0-only), SAM3 weights, and RawNIND checkpoints are never
   distributed with the donor and need separate user-accepted terms;
   deferral avoids premature rights entanglement.
4. **Pins stay traceable.** All four workspace pins plus the artcraft pin
   remain locked in `donor-pins.json`; a re-evaluation starts from exact
   commits, not rediscovery.
