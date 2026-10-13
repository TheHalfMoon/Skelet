import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { inspectJpeg } from "../src/jpeg-evidence.ts";
import {
  VIDEO_FRAME_BUDGET,
  VideoFrameError,
  assembleVideoEvidence,
  authenticateFrame,
  frameTimeMs,
  selectFrameRefs,
  validateVideoSource,
} from "../src/video-frame-evidence.ts";

const jpeg = new Uint8Array(readFileSync(new URL("./fixtures/valid.jpeg", import.meta.url)));
const jpegSize = (() => {
  const dimensions = inspectJpeg(jpeg);
  assert.ok(dimensions !== null, "valid.jpeg fixture must stay a valid JPEG");
  return dimensions;
})();

function spec(overrides = {}) {
  return validateVideoSource({
    videoSha256: "b".repeat(64),
    fps: 30,
    durationMs: 2000,
    width: 1280,
    height: 720,
    frameCount: 60,
    ...overrides,
  });
}

/** Source declaring the real fixture dimensions for authentication tests. */
function realSpec(overrides = {}) {
  return spec({ width: jpegSize.width, height: jpegSize.height, ...overrides });
}

test("valid source validates with normalized identity", () => {
  const parsed = validateVideoSource({
    videoSha256: "B".repeat(64),
    fps: 30,
    durationMs: 2000,
    width: 1280,
    height: 720,
    frameCount: 60,
  });
  assert.equal(parsed.videoSha256, "b".repeat(64));
  assert.equal(parsed.fps, 30);
});

test("malformed sources fail closed with typed codes", () => {
  const candidates = [
    null,
    "video",
    {},
    { videoSha256: "short" },
    { fps: 0 },
    { fps: -30 },
    { fps: 240 },
    { durationMs: 0 },
    { durationMs: 600001 },
    { width: 5000 },
    { frameCount: 0 },
    // Declared count disagrees with fps x duration (expects 60).
    { frameCount: 600 },
  ];
  for (const [index, patch] of candidates.entries()) {
    const base = {
      videoSha256: "b".repeat(64),
      fps: 30,
      durationMs: 2000,
      width: 1280,
      height: 720,
      frameCount: 60,
    };
    const input = patch !== null && typeof patch === "object" && Object.keys(patch).length > 0
      ? { ...base, ...patch }
      : patch;
    assert.throws(() => validateVideoSource(input), VideoFrameError, `case ${index}`);
  }
  // Oversized frame area fails as over-budget, not generic invalid.
  assert.throws(
    () => spec({ width: 4096, height: 4096 }),
    (error) => error instanceof VideoFrameError && error.code === "video-frame/over-budget",
  );
});

test("frame mapping is exact with whole milliseconds", () => {
  const parsed = spec();
  assert.equal(frameTimeMs(parsed, 0), 0);
  assert.equal(frameTimeMs(parsed, 30), 1000);
  assert.equal(frameTimeMs(parsed, 59), 1967);
  assert.throws(() => frameTimeMs(parsed, 60), VideoFrameError);
  assert.throws(() => frameTimeMs(parsed, -1), VideoFrameError);
  // Fractional fps stays exact: 24000/1001 NTSC-style.
  const ntsc = spec({ fps: 24000 / 1001, durationMs: 2000, frameCount: 48 });
  assert.equal(frameTimeMs(ntsc, 24), 1001);
});

test("uniform selection is deterministic with boundary coverage", () => {
  const parsed = spec();
  const full = selectFrameRefs(parsed, 64);
  assert.equal(full.length, 60);
  assert.equal(full[0]?.index, 0);
  assert.equal(full[59]?.index, 59);
  const capped = selectFrameRefs(parsed, 6);
  assert.deepEqual(capped.map((ref) => ref.index), [0, 12, 24, 35, 47, 59]);
  assert.equal(capped[0]?.tMs, 0);
  for (const ref of capped) {
    assert.equal(ref.tMs, frameTimeMs(parsed, ref.index));
  }
  assert.deepEqual(selectFrameRefs(parsed, 1), [{ index: 0, tMs: 0 }]);
  assert.deepEqual(selectFrameRefs(parsed, 6), capped);
  assert.throws(() => selectFrameRefs(parsed, 0), VideoFrameError);
  assert.throws(() => selectFrameRefs(parsed, VIDEO_FRAME_BUDGET.maxFrames + 1), VideoFrameError);
});

test("frame authentication binds dimensions and rejects corruption", () => {
  const parsed = spec();
  const real = realSpec();
  const evidence = authenticateFrame(real, 7, jpeg);
  assert.equal(evidence.index, 7);
  assert.equal(evidence.tMs, frameTimeMs(real, 7));
  assert.equal(evidence.width, jpegSize.width);
  assert.equal(evidence.height, jpegSize.height);
  assert.ok(evidence.sha256.length === 64 && evidence.bytes === jpeg.byteLength);
  assert.throws(() => authenticateFrame(real, 7, new Uint8Array([1, 2, 3])), VideoFrameError);
  assert.throws(() => authenticateFrame(real, 7, new Uint8Array(0)), VideoFrameError);
  // Dimension disagreement fails even for structurally valid JPEGs.
  assert.throws(() => authenticateFrame(parsed, 7, jpeg), VideoFrameError);
  assert.throws(() => authenticateFrame(real, 60, jpeg), VideoFrameError);
});

test("evidence assembly binds mapping and digests deterministically", () => {
  const real = realSpec();
  const refs = selectFrameRefs(real, 4);
  const frames = refs.map((ref) => authenticateFrame(real, ref.index, jpeg));
  const first = assembleVideoEvidence(real, frames, new Date("2026-10-13T00:00:00.000Z"));
  assert.equal(first.schema, "skelet/video-frame-evidence/1");
  assert.equal(first.frames.length, 4);
  assert.equal(first.videoSha256, "b".repeat(64));
  assert.ok(first.evidenceSha256.length === 64);
  const second = assembleVideoEvidence(real, frames, new Date("2026-10-13T00:00:00.000Z"));
  assert.deepEqual(second, first);
  // Substitution invalidates the record: retimed frames are rejected.
  const retimed = frames.map((frame) => ({ ...frame, tMs: frame.tMs + 1 }));
  assert.throws(() => assembleVideoEvidence(real, retimed), VideoFrameError);
  // Unordered, duplicate, empty, and mis-timed inputs are rejected.
  assert.throws(() => assembleVideoEvidence(real, [...frames].reverse()), VideoFrameError);
  assert.throws(() => assembleVideoEvidence(real, [frames[0], frames[0]].filter((frame) => frame !== undefined)), VideoFrameError);
  assert.throws(() => assembleVideoEvidence(real, []), VideoFrameError);
  assert.throws(() => assembleVideoEvidence(real, frames, new Date("bad")), VideoFrameError);
});
