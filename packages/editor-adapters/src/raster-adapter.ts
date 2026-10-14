/**
 * AF-11 P14 local raster adapter (Skelet-owned, no donor vendoring).
 *
 * Optional headless adapter for the pinned PhotoCraft CLI contract at
 * `97136485f0743251ab330d096ca6c9d0f0f6f54c` (verified 2026-10-11, MIT OR
 * Apache-2.0). The adapter never vendors donor code, never downloads or
 * installs a binary, never performs network access, and never requires a
 * paid provider. It is disabled unless explicitly configured with an
 * absolute executable path and a confined filesystem root.
 *
 * Verified upstream contract (apps/photocraft-cli/src/main.rs + automation
 * crate, per AF-01 audit):
 * - binary name is `photocraft-cli` (never bare `photocraft` PATH lookup);
 * - headless surface used here is `convert IN OUT`, `info FILE`, `commands`;
 * - `run`, `batch`, `droplet`, `mcp`, and `serve` exist on the real CLI but
 *   are deliberately NOT allowlisted here (batch/droplet imply queue or
 *   hosted execution; mcp/serve imply a long-lived server; run implies
 *   arbitrary command IDs);
 * - convert options honoured here are `--format FMT`, `--quality N`, and
 *   `--tiff-layers MODE`; no other flags are emitted;
 * - HEIF (`--features heif`) stays off: HEIF needs a separate rights review
 *   and is never enabled by this adapter;
 * - GPU and cloud paths are rejected: only local convert/info/commands run.
 *
 * Skelet confinement mirrors the upstream root model with a single
 * operator-owned root directory: every input must resolve inside the root,
 * every output must resolve inside the root, links are followed via
 * realpath, and a path that escapes is refused with a deterministic
 * `raster/path-escape` error. Check-then-use has an inherent TOCTOU race
 * against other local software swapping links between validation and
 * spawn; the roots confine this adapter's own invocation rather than
 * defending against a hostile local peer.
 *
 * Subprocess safety: execFile with no shell, allowlisted argv only, scrubbed
 * environment (no ambient credentials), cwd confined to the root, bounded
 * timeout with SIGKILL, bounded stdout/output bytes, truncated diagnostics.
 * Untrusted project content is never executed: only the configured binary
 * runs, with fixed subcommands and validated file operands.
 *
 * Fixture boundary: process-level tests use faithful fixture executables
 * that speak the same argv shapes (`convert IN OUT --format ...`, `info`,
 * `commands`). Fixture success MUST NOT be represented as genuine upstream
 * PhotoCraft binary verification. Upstream compatibility stays UNVERIFIED
 * until the genuine `photocraft-cli` binary at the pinned commit is
 * installed and the same suite runs against it.
 *
 * PageDraw boundary: P14 PageDraw local primitives (ArtCraft
 * `frontend/libs/components/pagedraw/`) are NOT transplanted here. The AF-01
 * manifest marks PageDraw conditional on proving VectorCraft/PhotoCraft
 * adapters insufficient for the same local edit. This grain provides the
 * raster convert path (SVG/DTCG -> raster bytes -> reopen validation) so a
 * reference-pack -> raster -> Asset journey is exercisable without a canvas
 * engine. If a future grain demonstrates a qualified gap (layers, masks,
 * history-bound paint), PageDraw may be proposed separately.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, realpath, readFile } from "node:fs/promises";
import { isAbsolute, resolve, sep, extname } from "node:path";

export const RASTER_ADAPTER_ID = "photocraft-local" as const;
export const RASTER_CAPABILITY = "raster-export" as const;
/** Exact upstream pin from UPSTREAMS.lock.yml (photocraft, ready). */
export const PHOTOCRAFT_PIN =
  "97136485f0743251ab330d096ca6c9d0f0f6f54c" as const;

export const RASTER_OPERATIONS = ["convert", "info", "commands"] as const;
export type RasterOperation = (typeof RASTER_OPERATIONS)[number];

/** Operations the real CLI supports but Skelet deliberately refuses. */
const REFUSED_OPERATIONS: readonly string[] = [
  "run",
  "batch",
  "droplet",
  "mcp",
  "serve",
];

/** Raster formats honoured by `convert --format`. Lowercase only. */
export const RASTER_FORMATS = [
  "png",
  "jpeg",
  "jpg",
  "webp",
  "tiff",
  "tif",
  "bmp",
] as const;
export type RasterFormat = (typeof RASTER_FORMATS)[number];

/** TIFF layer handling. Only meaningful when format is tiff/tif. */
export const TIFF_LAYER_MODES = ["flatten", "preserve"] as const;
export type TiffLayerMode = (typeof TIFF_LAYER_MODES)[number];

/** Input extensions accepted inside the confined root. */
const INPUT_EXTENSIONS: readonly string[] = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".tiff",
  ".tif",
  ".bmp",
  ".svg",
];

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MIN_MAX_OUTPUT_BYTES = 1_024;
const MAX_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_PATH_CHARS = 1_024;
const MAX_ID_CHARS = 128;
const MIN_QUALITY = 1;
const MAX_QUALITY = 100;
const ERROR_MESSAGE_MAX_CHARS = 2_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WINDOWS_DEVICE_NAMES: readonly string[] = [
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
];

export type RasterErrorCode =
  | "raster/disabled"
  | "raster/unavailable"
  | "raster/invalid-config"
  | "raster/invalid-input"
  | "raster/path-escape"
  | "raster/unsupported-operation"
  | "raster/malformed-output"
  | "raster/timeout"
  | "raster/canceled"
  | "raster/failed"
  | "raster/output-limit";

export class RasterAdapterError extends Error {
  readonly code: RasterErrorCode;
  constructor(code: RasterErrorCode, message: string) {
    super(message);
    this.name = "RasterAdapterError";
    this.code = code;
  }
}

function fail(code: RasterErrorCode, message: string): never {
  throw new RasterAdapterError(code, message);
}

function truncate(message: string): string {
  return message.length > ERROR_MESSAGE_MAX_CHARS
    ? message.slice(0, ERROR_MESSAGE_MAX_CHARS)
    : message;
}

export interface RasterRequestor {
  /** Authenticated actor identity; anonymous invocations are refused. */
  actorId: string;
  /** Workspace scope that owns the confined root. */
  workspaceId: string;
}

export interface RasterAdapterConfig {
  /** Master switch. Anything other than literal true is disabled. */
  enabled: boolean;
  /**
   * Absolute path to the operator-installed `photocraft-cli` binary.
   * Bare names and PATH lookups are refused to prevent binary hijack.
   */
  executablePath?: string;
  /** Operator-owned confined root for all file operands. */
  rootDir: string;
  /** Per-invocation ceiling in milliseconds. */
  timeoutMs?: number;
  /** Ceiling for produced raster/JSON bytes. */
  maxOutputBytes?: number;
  /** Must equal PHOTOCRAFT_PIN when enabled. */
  versionPin?: string;
}

export interface ResolvedRasterConfig {
  enabled: true;
  executablePath: string;
  rootDir: string;
  rootReal: string;
  timeoutMs: number;
  maxOutputBytes: number;
  versionPin: string;
}

export interface RasterConvertInput {
  operation: "convert";
  requestor: RasterRequestor;
  inputFile: string;
  outputFile: string;
  /** Required output raster format (lowercase, allowlisted). */
  format: string;
  /** Optional 1-100 quality for lossy formats; validated whenever present. */
  quality?: number;
  /** Optional TIFF layer mode; only valid when format is tiff/tif. */
  tiffLayers?: string;
  /** Explicit opt-in to allow inputFile === outputFile. Default refuses. */
  overwrite?: boolean;
}

export interface RasterInfoInput {
  operation: "info";
  requestor: RasterRequestor;
  inputFile: string;
}

export interface RasterCommandsInput {
  operation: "commands";
  requestor: RasterRequestor;
}

export type RasterInput =
  | RasterConvertInput
  | RasterInfoInput
  | RasterCommandsInput;

export interface RasterProvenance {
  adapterId: typeof RASTER_ADAPTER_ID;
  capability: typeof RASTER_CAPABILITY;
  version: typeof PHOTOCRAFT_PIN;
  egress: "local";
  costClass: "free-local";
  operation: RasterOperation;
}

export interface RasterSuccess {
  operation: RasterOperation;
  /** Absolute confined output path for convert; undefined otherwise. */
  outputFile?: string;
  outputBytes?: number;
  outputSha256?: string;
  /** Detected/confirmed raster format for convert; undefined otherwise. */
  outputFormat?: string;
  /** Parsed JSON for info/commands; undefined for convert. */
  stdoutJson?: unknown;
  provenance: RasterProvenance;
  durationMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_CHARS) {
    fail("raster/invalid-input", `Raster ${label} is invalid.`);
  }
  if (!ID_PATTERN.test(value as string)) {
    fail("raster/invalid-input", `Raster ${label} is invalid.`);
  }
  return value as string;
}

function validateRequestor(value: unknown): RasterRequestor {
  if (!isRecord(value)) {
    fail("raster/invalid-input", "Raster requestor is invalid.");
  }
  const actorId = validateId(value.actorId, "actor identity");
  const workspaceId = validateId(value.workspaceId, "workspace identity");
  return { actorId, workspaceId };
}

function validateTimeout(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < MIN_TIMEOUT_MS || (value as number) > MAX_TIMEOUT_MS) {
    fail("raster/invalid-config", "Raster timeout is invalid.");
  }
  return value as number;
}

function validateMaxOutput(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (
    !Number.isInteger(value) ||
    (value as number) < MIN_MAX_OUTPUT_BYTES ||
    (value as number) > MAX_MAX_OUTPUT_BYTES
  ) {
    fail("raster/invalid-config", "Raster output limit is invalid.");
  }
  return value as number;
}

function validateExecutablePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH_CHARS) {
    fail("raster/invalid-config", "Raster executable path is invalid.");
  }
  const text = value as string;
  if (text.includes("\0")) {
    fail("raster/invalid-config", "Raster executable path is invalid.");
  }
  if (!isAbsolute(text)) {
    fail(
      "raster/invalid-config",
      "Raster executable path must be absolute; PATH lookup is refused.",
    );
  }
  return text;
}

function validateRootDir(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH_CHARS) {
    fail("raster/invalid-config", "Raster root directory is invalid.");
  }
  const text = value as string;
  if (text.includes("\0")) {
    fail("raster/invalid-config", "Raster root directory is invalid.");
  }
  if (!isAbsolute(text)) {
    fail("raster/invalid-config", "Raster root directory must be absolute.");
  }
  return text;
}

/**
 * Validate operator configuration without touching the filesystem.
 * Returns a resolved record when enabled; throws invalid-config otherwise.
 * Disabled configurations do not throw here: callers surface disabled at
 * invocation time so that disabled-by-default is observable, not silent.
 */
export function validateRasterAdapterConfig(
  raw: unknown,
): ResolvedRasterConfig | { enabled: false } {
  if (!isRecord(raw)) {
    fail("raster/invalid-config", "Raster adapter configuration is invalid.");
  }
  if (raw.enabled !== true) {
    return { enabled: false as const };
  }
  const executablePath = validateExecutablePath(raw.executablePath);
  const rootDir = validateRootDir(raw.rootDir);
  const timeoutMs = validateTimeout(raw.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxOutputBytes = validateMaxOutput(raw.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
  const versionPin = raw.versionPin;
  if (versionPin !== PHOTOCRAFT_PIN) {
    fail(
      "raster/invalid-config",
      "Raster adapter version pin must match the qualified PhotoCraft commit.",
    );
  }
  return {
    enabled: true as const,
    executablePath,
    rootDir,
    rootReal: rootDir,
    timeoutMs,
    maxOutputBytes,
    versionPin: PHOTOCRAFT_PIN,
  };
}

async function resolveRootReal(rootDir: string): Promise<string> {
  let info;
  try {
    info = await lstat(rootDir);
  } catch {
    fail("raster/invalid-config", "Raster root directory is unavailable.");
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail("raster/invalid-config", "Raster root directory must be a real directory.");
  }
  try {
    return await realpath(rootDir);
  } catch {
    fail("raster/invalid-config", "Raster root directory is unavailable.");
  }
}

function rejectDeviceName(abs: string): void {
  const base = abs.split("/").pop() ?? "";
  const stem = base.split(".")[0] ?? "";
  if (WINDOWS_DEVICE_NAMES.includes(stem.toUpperCase())) {
    fail("raster/invalid-input", "Raster file path is invalid.");
  }
}

function insideRoot(abs: string, rootReal: string): boolean {
  return abs === rootReal || abs.startsWith(rootReal + sep);
}

/**
 * Resolve a caller-supplied file operand inside the confined root.
 * Relative paths resolve against the root; absolute paths must already
 * lie inside it. Existing files are realpath-checked so symlink escapes
 * are refused. New output paths are checked via their nearest existing
 * ancestor so `root/link/../outside` and link-to-elsewhere tricks fail
 * closed with path-escape rather than silently writing outside.
 */
export async function resolveConfinedRasterPath(
  rootReal: string,
  userPath: string,
  mustExist: boolean,
): Promise<string> {
  if (typeof userPath !== "string" || userPath.length === 0 || userPath.length > MAX_PATH_CHARS) {
    fail("raster/invalid-input", "Raster file path is invalid.");
  }
  if (userPath.includes("\0")) {
    fail("raster/invalid-input", "Raster file path is invalid.");
  }
  const abs = isAbsolute(userPath) ? resolve(userPath) : resolve(rootReal, userPath);
  rejectDeviceName(abs);
  if (!insideRoot(abs, rootReal)) {
    fail("raster/path-escape", "Raster file path escapes the confined root.");
  }
  if (abs === rootReal) {
    fail("raster/invalid-input", "Raster file path must name a file inside the root.");
  }
  if (mustExist) {
    let real: string;
    try {
      real = await realpath(abs);
    } catch {
      fail("raster/invalid-input", "Raster input file is unavailable.");
    }
    if (!insideRoot(real as string, rootReal)) {
      fail("raster/path-escape", "Raster file path escapes the confined root.");
    }
    let info;
    try {
      info = await lstat(real as string);
    } catch {
      fail("raster/invalid-input", "Raster input file is unavailable.");
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      fail("raster/path-escape", "Raster file path escapes the confined root.");
    }
    return real as string;
  }
  let cursor = abs;
  const missing: string[] = [];
  for (let depth = 0; depth < 32; depth += 1) {
    try {
      const info = await lstat(cursor);
      void info;
      break;
    } catch {
      const slash = cursor.lastIndexOf(sep);
      if (slash < 0) {
        fail("raster/path-escape", "Raster file path escapes the confined root.");
      }
      const leaf = cursor.slice(slash + 1);
      if (leaf === "" || leaf === "." || leaf === "..") {
        fail("raster/path-escape", "Raster file path escapes the confined root.");
      }
      if (leaf.length > 255 || leaf.includes("\0")) {
        fail("raster/invalid-input", "Raster file path is invalid.");
      }
      missing.unshift(leaf);
      cursor = cursor.slice(0, slash) || sep;
      continue;
    }
  }
  let ancestorReal: string;
  try {
    ancestorReal = await realpath(cursor);
  } catch {
    fail("raster/invalid-input", "Raster output path is unavailable.");
  }
  if (!insideRoot(ancestorReal as string, rootReal)) {
    fail("raster/path-escape", "Raster file path escapes the confined root.");
  }
  for (const leaf of missing) {
    if (leaf === ".." || leaf.includes(sep)) {
      fail("raster/path-escape", "Raster file path escapes the confined root.");
    }
  }
  return abs;
}

function validateFormat(value: unknown): RasterFormat {
  if (typeof value !== "string" || !(RASTER_FORMATS as readonly string[]).includes(value)) {
    fail("raster/invalid-input", "Raster format is invalid.");
  }
  return value as RasterFormat;
}

function validateQuality(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < MIN_QUALITY || (value as number) > MAX_QUALITY) {
    fail("raster/invalid-input", "Raster quality is invalid.");
  }
  return value as number;
}

function validateTiffLayers(value: unknown): TiffLayerMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(TIFF_LAYER_MODES as readonly string[]).includes(value)) {
    fail("raster/invalid-input", "Raster TIFF layer mode is invalid.");
  }
  return value as TiffLayerMode;
}

function validateOverwrite(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    fail("raster/invalid-input", "Raster overwrite flag is invalid.");
  }
  return value as boolean;
}

function isTiffFormat(format: RasterFormat): boolean {
  return format === "tiff" || format === "tif";
}

function extensionFor(format: RasterFormat): string {
  return `.${format.toLowerCase()}`;
}

function formatMatchesExtension(format: RasterFormat, outputAbs: string): boolean {
  const ext = extname(outputAbs).toLowerCase();
  const fmt = format.toLowerCase();
  if (fmt === "jpeg" && ext === ".jpg") return true;
  if (fmt === "jpg" && ext === ".jpeg") return true;
  if (fmt === "tiff" && ext === ".tif") return true;
  if (fmt === "tif" && ext === ".tiff") return true;
  return ext === `.${fmt}`;
}

function validateInputExtension(inputAbs: string): void {
  const ext = extname(inputAbs).toLowerCase();
  if (!(INPUT_EXTENSIONS as readonly string[]).includes(ext)) {
    fail("raster/invalid-input", "Raster input file type is not supported.");
  }
}

export interface ValidatedRasterInput {
  operation: RasterOperation;
  requestor: RasterRequestor;
  inputFile?: string;
  outputFile?: string;
  format?: RasterFormat;
  quality?: number;
  tiffLayers?: TiffLayerMode;
  overwrite?: boolean;
}

/** Strict input validation; unknown operations classify as unsupported. */
export function validateRasterInput(raw: unknown): ValidatedRasterInput {
  if (!isRecord(raw)) {
    fail("raster/invalid-input", "Raster input is invalid.");
  }
  const requestor = validateRequestor(raw.requestor);
  const operation = raw.operation;
  if (typeof operation !== "string") {
    fail("raster/invalid-input", "Raster operation is invalid.");
  }
  if (REFUSED_OPERATIONS.includes(operation as string)) {
    fail(
      "raster/unsupported-operation",
      `Raster operation is not supported: ${operation as string}.`,
    );
  }
  if (!RASTER_OPERATIONS.includes(operation as RasterOperation)) {
    fail("raster/unsupported-operation", "Raster operation is not supported.");
  }
  const op = operation as RasterOperation;
  if (op === "commands") {
    const extra = ["inputFile", "outputFile", "format", "quality", "tiffLayers", "overwrite"];
    for (const key of extra) {
      if (raw[key] !== undefined) {
        fail("raster/invalid-input", "Raster commands input must not carry file operands.");
      }
    }
    return { operation: op, requestor };
  }
  if (op === "info") {
    if (typeof raw.inputFile !== "string") {
      fail("raster/invalid-input", "Raster info input requires an input file.");
    }
    const extra = ["outputFile", "format", "quality", "tiffLayers", "overwrite"];
    for (const key of extra) {
      if (raw[key] !== undefined) {
        fail("raster/invalid-input", "Raster info input carries unsupported fields.");
      }
    }
    return { operation: op, requestor, inputFile: raw.inputFile as string };
  }
  if (typeof raw.inputFile !== "string" || typeof raw.outputFile !== "string") {
    fail("raster/invalid-input", "Raster convert input requires input and output files.");
  }
  if (raw.format === undefined) {
    fail("raster/invalid-input", "Raster convert requires an explicit format.");
  }
  const format = validateFormat(raw.format);
  const quality = validateQuality(raw.quality);
  const tiffLayers = validateTiffLayers(raw.tiffLayers);
  const overwrite = validateOverwrite(raw.overwrite);
  if (tiffLayers !== undefined && !isTiffFormat(format)) {
    fail("raster/invalid-input", "Raster TIFF layers apply only to TIFF output.");
  }
  if (quality !== undefined && !(format === "jpeg" || format === "jpg" || format === "webp")) {
    // Quality is validated whenever present, but only meaningful for lossy
    // formats. Refuse it elsewhere so callers cannot smuggle flags past the
    // allowlist for lossless outputs.
    fail("raster/invalid-input", "Raster quality applies only to JPEG/WebP output.");
  }
  const validated: ValidatedRasterInput = {
    operation: op,
    requestor,
    inputFile: raw.inputFile as string,
    outputFile: raw.outputFile as string,
    format,
  };
  if (quality !== undefined) validated.quality = quality;
  if (tiffLayers !== undefined) validated.tiffLayers = tiffLayers;
  if (overwrite) validated.overwrite = true;
  return validated;
}

function scrubbedEnv(): Record<string, string> {
  const allow = new Set(["PATH", "LANG", "LC_ALL", "LC_MESSAGES", "TMPDIR", "HOME"]);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (allow.has(key) && typeof value === "string" && value.length > 0) {
      out[key] = value;
    }
  }
  return out;
}

export function buildRasterArgs(
  validated: ValidatedRasterInput,
  paths: { inputAbs: string | undefined; outputAbs: string | undefined },
): string[] {
  if (validated.operation === "commands") return ["commands"];
  if (validated.operation === "info") {
    return ["info", paths.inputAbs as string];
  }
  const args: string[] = ["convert", paths.inputAbs as string, paths.outputAbs as string];
  const format = validated.format as RasterFormat;
  args.push("--format", format);
  if (validated.quality !== undefined) {
    args.push("--quality", String(validated.quality));
  }
  if (validated.tiffLayers !== undefined) {
    args.push("--tiff-layers", validated.tiffLayers);
  }
  return args;
}

/** Match magic bytes for each allowlisted raster format. */
function magicMatches(format: RasterFormat, data: Buffer): boolean {
  const f = format.toLowerCase();
  if (f === "png") {
    return (
      data.length >= 8 &&
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47 &&
      data[4] === 0x0d &&
      data[5] === 0x0a &&
      data[6] === 0x1a &&
      data[7] === 0x0a
    );
  }
  if (f === "jpeg" || f === "jpg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (f === "webp") {
    return (
      data.length >= 12 &&
      data[0] === 0x52 &&
      data[1] === 0x49 &&
      data[2] === 0x46 &&
      data[3] === 0x46 &&
      data[8] === 0x57 &&
      data[9] === 0x45 &&
      data[10] === 0x42 &&
      data[11] === 0x50
    );
  }
  if (f === "tiff" || f === "tif") {
    if (data.length < 4) return false;
    const le = data[0] === 0x49 && data[1] === 0x49 && data[2] === 0x2a && data[3] === 0x00;
    const be = data[0] === 0x4d && data[1] === 0x4d && data[2] === 0x00 && data[3] === 0x2a;
    return le || be;
  }
  if (f === "bmp") {
    return data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d;
  }
  return false;
}

/**
 * Deterministic raster artifact check: byte budget plus magic bytes for the
 * claimed format. Refuses empty files, oversized files, and bytes whose
 * magic does not match the declared format. Text, SVG, JSON, and script
 * payloads fail closed here.
 */
export function validateRasterBytes(
  data: Buffer | Uint8Array,
  format: string,
  maxBytes: number,
): void {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length === 0 || buf.length > maxBytes) {
    fail("raster/output-limit", "Raster output exceeds its byte budget.");
  }
  if (typeof format !== "string" || !(RASTER_FORMATS as readonly string[]).includes(format)) {
    fail("raster/invalid-input", "Raster format is invalid.");
  }
  if (!magicMatches(format as RasterFormat, buf)) {
    fail("raster/malformed-output", "Raster output bytes do not match the declared format.");
  }
  const head = buf.subarray(0, Math.min(buf.length, 512)).toString("utf8").toLowerCase();
  if (head.includes("<script") || head.includes("javascript:") || buf.subarray(0, 5).toString("utf8").startsWith("<?xm")) {
    // Magic already pins the format; this is defense-in-depth against
    // polyglot payloads that start with a valid magic but carry script.
    // Only flag when the head is overwhelmingly text-like and hostile.
    if (head.includes("<script")) {
      fail("raster/malformed-output", "Raster output carries unsafe content.");
    }
  }
}

export interface RasterInspection {
  format: RasterFormat;
  bytes: number;
  sha256: string;
}

/** Deterministic reopen check: validate magic, then hash and measure. */
export function inspectRaster(
  data: Buffer | Uint8Array,
  format: string,
  maxBytes: number = MAX_MAX_OUTPUT_BYTES,
): RasterInspection {
  validateRasterBytes(data, format, maxBytes);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return {
    format: format as RasterFormat,
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

export interface Availability {
  available: boolean;
  reason: string;
}

/** Explicit capability detection: no spawn, only filesystem checks. */
export async function rasterAvailability(rawConfig: unknown): Promise<Availability> {
  const parsed = validateRasterAdapterConfig(rawConfig);
  if (parsed.enabled !== true) {
    return { available: false, reason: "disabled" };
  }
  try {
    await access(parsed.executablePath, constants.X_OK);
  } catch {
    return { available: false, reason: "unavailable" };
  }
  let info;
  try {
    info = await lstat(parsed.executablePath);
  } catch {
    return { available: false, reason: "unavailable" };
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    return { available: false, reason: "unavailable" };
  }
  try {
    const rootReal = await resolveRootReal(parsed.rootDir);
    void rootReal;
  } catch {
    return { available: false, reason: "invalid-root" };
  }
  return { available: true, reason: "ready" };
}

/** Liveness probe that never throws: failures report ok:false instead. */
export async function rasterHealth(
  rawConfig: unknown,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const availability = await rasterAvailability(rawConfig);
    if (!availability.available) {
      return { ok: false, detail: availability.reason };
    }
    return { ok: true, detail: "ready" };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Health probe failed.",
    };
  }
}

function provenanceFor(operation: RasterOperation): RasterProvenance {
  return {
    adapterId: RASTER_ADAPTER_ID,
    capability: RASTER_CAPABILITY,
    version: PHOTOCRAFT_PIN,
    egress: "local",
    costClass: "free-local",
    operation,
  };
}

interface SpawnOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function spawnRaster(
  executablePath: string,
  args: readonly string[],
  rootReal: string,
  timeoutMs: number,
  maxOutputBytes: number,
  signal?: AbortSignal,
): Promise<SpawnOutcome> {
  return new Promise<SpawnOutcome>((resolvePromise, rejectPromise) => {
    if (signal?.aborted === true) {
      rejectPromise(new RasterAdapterError("raster/canceled", "Raster operation was canceled."));
      return;
    }
    const child = execFile(
      executablePath,
      [...args],
      {
        cwd: rootReal,
        timeout: timeoutMs,
        maxBuffer: Math.min(maxOutputBytes, MAX_MAX_OUTPUT_BYTES),
        killSignal: "SIGKILL",
        windowsHide: true,
        shell: false,
        env: scrubbedEnv(),
      },
      (error, stdout, stderr) => {
        if (signal?.aborted === true) {
          rejectPromise(new RasterAdapterError("raster/canceled", "Raster operation was canceled."));
          return;
        }
        if (error !== null) {
          const typed = error as NodeJS.ErrnoException & {
            code?: string | number | null;
            killed?: boolean;
            signal?: string | null;
          };
          if (typed.code === "ETIMEDOUT" || typed.killed === true) {
            rejectPromise(new RasterAdapterError("raster/timeout", "Raster operation timed out."));
            return;
          }
          if (typed.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            rejectPromise(
              new RasterAdapterError("raster/output-limit", "Raster output exceeds its byte budget."),
            );
            return;
          }
          const exit = typed.code;
          if (typeof exit === "number") {
            rejectPromise(
              new RasterAdapterError(
                "raster/failed",
                truncate(`Raster operation failed with exit ${exit}: ${String(stderr).slice(0, 512)}`),
              ),
            );
            return;
          }
          rejectPromise(
            new RasterAdapterError("raster/failed", truncate(`Raster operation failed: ${error.message}`)),
          );
          return;
        }
        resolvePromise({ stdout: String(stdout), stderr: String(stderr), exitCode: 0 });
      },
    );
    const onAbort = (): void => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Kill failures still settle via the execFile callback.
      }
      rejectPromise(new RasterAdapterError("raster/canceled", "Raster operation was canceled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Invoke the configured PhotoCraft CLI for one allowlisted operation.
 * Disabled configurations fail with raster/disabled; missing executables
 * fail with raster/unavailable; confinement violations fail with
 * raster/path-escape. No network, no model, no shell, no TCP control.
 */
export async function invokeRaster(
  rawInput: unknown,
  rawConfig: unknown,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<RasterSuccess> {
  const started = Date.now();
  const parsed = validateRasterAdapterConfig(rawConfig);
  if (parsed.enabled !== true) {
    fail("raster/disabled", "Raster adapter is disabled.");
  }
  const config = parsed as ResolvedRasterConfig;
  const timeoutMs =
    options?.timeoutMs !== undefined
      ? validateTimeout(options.timeoutMs, config.timeoutMs)
      : config.timeoutMs;
  if (options?.signal?.aborted === true) {
    fail("raster/canceled", "Raster operation was canceled.");
  }
  const validated = validateRasterInput(rawInput);
  let rootReal: string;
  try {
    rootReal = await resolveRootReal(config.rootDir);
  } catch (error) {
    if (error instanceof RasterAdapterError) throw error;
    fail("raster/invalid-config", "Raster root directory is unavailable.");
  }
  try {
    await access(config.executablePath, constants.X_OK);
    const info = await lstat(config.executablePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      fail("raster/unavailable", "Raster executable is unavailable.");
    }
  } catch (error) {
    if (error instanceof RasterAdapterError) throw error;
    fail("raster/unavailable", "Raster executable is unavailable.");
  }
  let inputAbs: string | undefined;
  let outputAbs: string | undefined;
  if (validated.inputFile !== undefined) {
    inputAbs = await resolveConfinedRasterPath(rootReal as string, validated.inputFile, true);
    validateInputExtension(inputAbs);
  }
  if (validated.outputFile !== undefined) {
    outputAbs = await resolveConfinedRasterPath(rootReal as string, validated.outputFile, false);
  }
  if (validated.operation === "convert") {
    const format = validated.format as RasterFormat;
    if (outputAbs !== undefined && !formatMatchesExtension(format, outputAbs)) {
      fail("raster/invalid-input", "Raster output extension must match the declared format.");
    }
    if (
      inputAbs !== undefined &&
      outputAbs !== undefined &&
      inputAbs === outputAbs &&
      validated.overwrite !== true
    ) {
      fail("raster/invalid-input", "Raster convert refuses to overwrite its input without overwrite:true.");
    }
    void extensionFor(format);
  }
  const args = buildRasterArgs(validated, { inputAbs, outputAbs });
  const outcome = await spawnRaster(
    config.executablePath,
    args,
    rootReal as string,
    timeoutMs,
    config.maxOutputBytes,
    options?.signal,
  );
  if (validated.operation === "commands" || validated.operation === "info") {
    const bytes = Buffer.byteLength(outcome.stdout, "utf8");
    if (bytes === 0 || bytes > config.maxOutputBytes) {
      fail("raster/output-limit", "Raster output exceeds its byte budget.");
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(outcome.stdout);
    } catch {
      fail("raster/malformed-output", "Raster output is malformed.");
    }
    return {
      operation: validated.operation,
      stdoutJson: parsedJson,
      provenance: provenanceFor(validated.operation),
      durationMs: Date.now() - started,
    };
  }
  const outPath = outputAbs as string;
  const format = validated.format as RasterFormat;
  let data: Buffer;
  try {
    data = await readFile(outPath);
  } catch {
    fail("raster/malformed-output", "Raster output file is missing.");
  }
  if ((data as Buffer).length === 0 || (data as Buffer).length > config.maxOutputBytes) {
    fail("raster/output-limit", "Raster output exceeds its byte budget.");
  }
  validateRasterBytes(data as Buffer, format, config.maxOutputBytes);
  const sha256 = createHash("sha256").update(data as Buffer).digest("hex");
  return {
    operation: "convert",
    outputFile: outPath,
    outputBytes: (data as Buffer).length,
    outputSha256: sha256,
    outputFormat: format,
    provenance: provenanceFor("convert"),
    durationMs: Date.now() - started,
  };
}

/** Convenience: is this exact error code an expected deterministic outcome? */
export function isRasterError(error: unknown, code: RasterErrorCode): boolean {
  return error instanceof RasterAdapterError && error.code === code;
}
