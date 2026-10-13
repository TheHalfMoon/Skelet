import { createHash } from "node:crypto";

import { inspectJpeg } from "./jpeg-evidence.ts";

/**
 * AF-06-i bounded video-frame evidence: time/frame mapping, budgets, and
 * provenance for optional replay/video evidence on flow steps (P10).
 *
 * Scope discipline: this module maps, bounds, and authenticates decoded
 * frames. It does NOT decode video containers: no ffmpeg, no codec, no
 * network, no GPU. Callers supply decoded candidate frames (e.g. JPEG);
 * every frame is structurally validated by `inspectJpeg` before it can
 * enter evidence. Unsupported containers fail closed with a typed code
 * instead of partial success.
 */

export const VIDEO_FRAME_BUDGET = {
  maxFrames: 64,
  maxSide: 4096,
  maxPixels: 16_000_000,
  maxFps: 120,
  maxDurationMs: 600_000,
  maxFrameBytes: 8_388_608,
} as const;

export interface VideoSourceSpec {
  /** SHA-256 of the source video bytes (identity, not content). */
  videoSha256: string;
  /** Frames per second, (0, 120]. */
  fps: number;
  /** Duration in whole milliseconds, (0, 600000]. */
  durationMs: number;
  /** Declared frame dimensions, each in (0, 4096]. */
  width: number;
  height: number;
  /** Declared total frame count, consistent with fps x duration. */
  frameCount: number;
}

export interface VideoFrameRef {
  index: number;
  tMs: number;
}

export interface VideoFrameEvidence {
  index: number;
  tMs: number;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
}

export interface VideoEvidence {
  schema: "skelet/video-frame-evidence/1";
  videoSha256: string;
  fps: number;
  durationMs: number;
  frames: VideoFrameEvidence[];
  evidenceSha256: string;
  capturedAt: string;
}

export class VideoFrameError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "VideoFrameError";
    this.code = code;
  }
}

function invalid(message: string): VideoFrameError {
  return new VideoFrameError("video-frame/invalid-spec", message);
}

function overBudget(message: string): VideoFrameError {
  return new VideoFrameError("video-frame/over-budget", message);
}

const HEX64 = /^[0-9a-f]{64}$/;

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Validate a source declaration; anything malformed fails closed. */
export function validateVideoSource(spec: unknown): VideoSourceSpec {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw invalid("Video source must be an object.");
  }
  const candidate = spec as Partial<Record<keyof VideoSourceSpec, unknown>>;
  if (typeof candidate.videoSha256 !== "string" || !HEX64.test(candidate.videoSha256.toLowerCase())) {
    throw invalid("Video identity must be a 64-hex SHA-256.");
  }
  if (typeof candidate.fps !== "number" || !(candidate.fps > 0) || candidate.fps > VIDEO_FRAME_BUDGET.maxFps) {
    throw invalid("Video fps must be within (0, 120].");
  }
  if (!isPositiveInt(candidate.durationMs) || candidate.durationMs > VIDEO_FRAME_BUDGET.maxDurationMs) {
    throw invalid("Video duration must be 1..600000 ms.");
  }
  if (!isPositiveInt(candidate.width) || candidate.width > VIDEO_FRAME_BUDGET.maxSide) {
    throw invalid("Video width is out of bounds.");
  }
  if (!isPositiveInt(candidate.height) || candidate.height > VIDEO_FRAME_BUDGET.maxSide) {
    throw invalid("Video height is out of bounds.");
  }
  if (candidate.width * candidate.height > VIDEO_FRAME_BUDGET.maxPixels) {
    throw overBudget("Video frame area exceeds the pixel budget.");
  }
  if (!isPositiveInt(candidate.frameCount)) {
    throw invalid("Video frame count must be a positive integer.");
  }
  if (candidate.frameCount > VIDEO_FRAME_BUDGET.maxFrames * 64) {
    throw overBudget("Video frame count exceeds the source budget.");
  }
  // Declared count must agree with fps x duration within one frame:
  // metadata that disagrees with itself is untrustworthy input.
  const expected = Math.round((candidate.fps * candidate.durationMs) / 1000);
  if (Math.abs(candidate.frameCount - expected) > 1) {
    throw invalid("Video frame count disagrees with fps and duration.");
  }
  return {
    videoSha256: candidate.videoSha256.toLowerCase(),
    fps: candidate.fps,
    durationMs: candidate.durationMs,
    width: candidate.width,
    height: candidate.height,
    frameCount: candidate.frameCount,
  };
}

/** Exact time mapping: frame index -> whole milliseconds, no float drift. */
export function frameTimeMs(spec: VideoSourceSpec, index: number): number {
  if (!isPositiveInt(index + 1) || index >= spec.frameCount) {
    throw invalid("Frame index is out of range.");
  }
  return Math.round((index * 1000) / spec.fps);
}

/**
 * Deterministic uniform selection of at most maxFrames indices across
 * the declared count. Same inputs always yield the same refs; endpoints
 * (first/last frame) are always included when the count exceeds the cap
 * so coverage never silently drops the boundaries.
 */
export function selectFrameRefs(spec: VideoSourceSpec, maxFrames: number): VideoFrameRef[] {
  if (!isPositiveInt(maxFrames) || maxFrames > VIDEO_FRAME_BUDGET.maxFrames) {
    throw overBudget("Frame selection exceeds the evidence budget.");
  }
  const count = Math.min(spec.frameCount, maxFrames);
  if (spec.frameCount <= maxFrames) {
    return Array.from({ length: spec.frameCount }, (_, index) => ({
      index,
      tMs: frameTimeMs(spec, index),
    }));
  }
  if (count === 1) return [{ index: 0, tMs: frameTimeMs(spec, 0) }];
  const refs: VideoFrameRef[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const index = Math.round((slot * (spec.frameCount - 1)) / (count - 1));
    refs.push({ index, tMs: frameTimeMs(spec, index) });
  }
  return refs;
}

function sha256HexBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Re-authenticate an assembled evidence record presented as unknown input
 * (e.g. crossing a worker boundary or arriving with a report attach
 * request). Verifies the schema tag, field shapes and budgets, mapping
 * consistency, uniform frame dimensions, and the record digest itself.
 * Anything off fails closed; valid records return typed as-is.
 */
export function validateVideoEvidenceRecord(value: unknown): VideoEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VideoFrameError("video-frame/corrupt-frame", "Video evidence must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schema !== "skelet/video-frame-evidence/1") {
    throw new VideoFrameError("video-frame/corrupt-frame", "Video evidence schema is unsupported.");
  }
  if (typeof candidate.videoSha256 !== "string" || !HEX64.test(candidate.videoSha256.toLowerCase())) {
    throw new VideoFrameError("video-frame/corrupt-frame", "Video identity must be a 64-hex SHA-256.");
  }
  if (typeof candidate.fps !== "number" || !(candidate.fps > 0) || candidate.fps > VIDEO_FRAME_BUDGET.maxFps) {
    throw new VideoFrameError("video-frame/corrupt-frame", "Video fps is out of bounds.");
  }
  if (!isPositiveInt(candidate.durationMs) || candidate.durationMs > VIDEO_FRAME_BUDGET.maxDurationMs) {
    throw new VideoFrameError("video-frame/corrupt-frame", "Video duration is out of bounds.");
  }
  // Upper index bound from fps x duration (partial selections are
  // legitimate evidence, so the count is a ceiling, not an identity).
  const declaredCount = Math.round((candidate.fps * candidate.durationMs) / 1000);
  if (!Array.isArray(candidate.frames) || candidate.frames.length === 0) {
    throw new VideoFrameError("video-frame/corrupt-frame", "Video evidence needs at least one frame.");
  }
  if (candidate.frames.length > VIDEO_FRAME_BUDGET.maxFrames) {
    throw new VideoFrameError("video-frame/over-budget", "Video evidence exceeds the frame budget.");
  }
  const first = candidate.frames[0] as Record<string, unknown>;
  if (!isPositiveInt(first.width) || (first.width as number) > VIDEO_FRAME_BUDGET.maxSide ||
      !isPositiveInt(first.height) || (first.height as number) > VIDEO_FRAME_BUDGET.maxSide) {
    throw new VideoFrameError("video-frame/corrupt-frame", "Frame dimensions are out of bounds.");
  }
  if ((first.width as number) * (first.height as number) > VIDEO_FRAME_BUDGET.maxPixels) {
    throw new VideoFrameError("video-frame/over-budget", "Video frame area exceeds the pixel budget.");
  }
  let previous = -1;
  for (const entry of candidate.frames) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new VideoFrameError("video-frame/corrupt-frame", "Video frame must be an object.");
    }
    const frame = entry as Record<string, unknown>;
    if (!isPositiveInt((frame.index as number) + 1) || (frame.index as number) <= previous) {
      throw new VideoFrameError("video-frame/corrupt-frame", "Video frame order is invalid.");
    }
    previous = frame.index as number;
    if ((frame.index as number) > declaredCount) {
      throw new VideoFrameError("video-frame/corrupt-frame", "Frame index exceeds the declared duration.");
    }
    if (frame.tMs !== Math.round(((frame.index as number) * 1000) / (candidate.fps as number))) {
      throw new VideoFrameError("video-frame/corrupt-frame", "Frame timestamp disagrees with the mapping.");
    }
    if (typeof frame.sha256 !== "string" || !HEX64.test(frame.sha256.toLowerCase())) {
      throw new VideoFrameError("video-frame/corrupt-frame", "Frame digest is invalid.");
    }
    if (frame.width !== first.width || frame.height !== first.height) {
      throw new VideoFrameError("video-frame/corrupt-frame", "Frame dimensions disagree with the source.");
    }
    if (!isPositiveInt(frame.bytes as number) || (frame.bytes as number) > VIDEO_FRAME_BUDGET.maxFrameBytes) {
      throw new VideoFrameError("video-frame/over-budget", "Frame bytes exceed the frame budget.");
    }
  }
  if (typeof candidate.capturedAt !== "string" || Number.isNaN(Date.parse(candidate.capturedAt))) {
    throw new VideoFrameError("video-frame/corrupt-frame", "Video evidence timestamp is invalid.");
  }
  if (typeof candidate.evidenceSha256 !== "string" || !HEX64.test(candidate.evidenceSha256.toLowerCase())) {
    throw new VideoFrameError("video-frame/corrupt-frame", "Video evidence digest is invalid.");
  }
  const { evidenceSha256, ...body } = candidate as unknown as VideoEvidence & { evidenceSha256: string };
  const recomputed = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  if (recomputed !== (evidenceSha256 as string).toLowerCase()) {
    throw new VideoFrameError("video-frame/corrupt-frame", "Video evidence digest does not match its body.");
  }
  return candidate as unknown as VideoEvidence;
}

/**
 * Authenticate one decoded candidate frame against the declared source:
 * JPEG structure, declared dimensions, and byte budget. Returns evidence
 * bound to the source identity and timestamp.
 */
export function authenticateFrame(
  spec: VideoSourceSpec,
  index: number,
  jpegBytes: Uint8Array,
): VideoFrameEvidence {
  if (!(jpegBytes instanceof Uint8Array)) {
    throw new VideoFrameError("video-frame/corrupt-frame", "Frame bytes are missing.");
  }
  if (jpegBytes.byteLength === 0 || jpegBytes.byteLength > VIDEO_FRAME_BUDGET.maxFrameBytes) {
    throw overBudget("Frame bytes exceed the frame budget.");
  }
  const dimensions = inspectJpeg(jpegBytes);
  if (dimensions === null) {
    throw new VideoFrameError("video-frame/corrupt-frame", "Frame is not a valid JPEG.");
  }
  if (dimensions.width !== spec.width || dimensions.height !== spec.height) {
    throw new VideoFrameError("video-frame/corrupt-frame", "Frame dimensions disagree with the source.");
  }
  return {
    index,
    tMs: frameTimeMs(spec, index),
    sha256: sha256HexBytes(jpegBytes),
    width: dimensions.width,
    height: dimensions.height,
    bytes: jpegBytes.byteLength,
  };
}

/**
 * Assemble the evidence record over authenticated frames. Frame refs must
 * be strictly increasing within the declared count; the record digest
 * binds source identity, mapping, and frame digests so any substitution
 * invalidates the evidence.
 */
export function assembleVideoEvidence(
  spec: VideoSourceSpec,
  frames: VideoFrameEvidence[],
  now: Date = new Date(),
): VideoEvidence {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw invalid("Video evidence needs at least one frame.");
  }
  if (frames.length > VIDEO_FRAME_BUDGET.maxFrames) {
    throw overBudget("Video evidence exceeds the frame budget.");
  }
  if (Number.isNaN(now.getTime())) throw invalid("Timestamp is invalid.");
  let previous = -1;
  for (const frame of frames) {
    if (!isPositiveInt(frame.index + 1) || frame.index <= previous || frame.index >= spec.frameCount) {
      throw invalid("Video frame order is invalid.");
    }
    previous = frame.index;
    if (frame.tMs !== frameTimeMs(spec, frame.index)) {
      throw new VideoFrameError("video-frame/corrupt-frame", "Frame timestamp disagrees with the mapping.");
    }
  }
  const body = {
    schema: "skelet/video-frame-evidence/1" as const,
    videoSha256: spec.videoSha256,
    fps: spec.fps,
    durationMs: spec.durationMs,
    frames,
    capturedAt: now.toISOString(),
  };
  const evidenceSha256 = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return { ...body, evidenceSha256 };
}
