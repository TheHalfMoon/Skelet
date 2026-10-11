import { createHash } from "node:crypto";

import {
  assembleKitManifest,
  partitionKitArtifacts,
  type KitManifest,
  type KitManifestRequest,
} from "./kit-manifest.ts";

/**
 * G09b-06 deterministic kit ZIP packaging.
 *
 * Pure and dependency-free: builds a stored (uncompressed) ZIP from a
 * frozen kit manifest plus caller-supplied documents, or fails closed
 * with a typed error. No compression means byte-identical output for
 * identical inputs; fixed DOS timestamps, sorted entries, and no extra
 * fields remove every other nondeterminism source.
 *
 * Self-record rule (no hash games, no preimage puzzles): the
 * `manifest.json` artifact record does NOT claim to hash the document
 * that contains it. It carries `manifestSelfDigest` — the SHA-256 of
 * the canonical manifest with the self entry removed — plus the exact
 * byte length of the stored document. Packaging re-derives both from
 * the manifest and compares against the record and the supplied
 * document. Every other shippable document must hash exactly to its
 * record. `finalizeKitManifest` constructs such a consistent pair.
 *
 * Integrity model: withheld (non-redistributable) bytes MUST NOT be
 * supplied. Their presence fails the build instead of being silently
 * dropped, so a caller bug can never leak restricted bytes into a
 * download set.
 */

const MAX_ZIP_ENTRIES = 500;
const FIXED_DOS_TIME = 0x0000;
const FIXED_DOS_DATE = 0x5021; // 2020-01-01
const EXT_ATTR_FILE = 0x81a40000;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32Bytes(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ (data[i] as number)) & 0xff] as number ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function sha256HexBytes(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Canonical JSON: sorted object keys, no whitespace. Deterministic bytes. */
export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Uint8Array) throw new KitPackageError("kit-package/unserializable", "Byte payloads are not JSON serializable.");
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export class KitPackageError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "KitPackageError";
    this.code = code;
  }
}

function invalid(message: string): KitPackageError {
  return new KitPackageError("kit-package/invalid-input", message);
}

/**
 * The self digest: SHA-256 of the canonical manifest with the
 * `manifest.json` entry removed. Stable under any self-record values,
 * so construction never chases its own hash.
 */
export function manifestSelfDigest(manifest: KitManifest): string {
  if (typeof manifest !== "object" || manifest === null || !Array.isArray(manifest.artifacts)) {
    throw invalid("Kit manifest must be an object with an artifact list.");
  }
  return sha256HexBytes(canonicalJsonBytes({
    ...manifest,
    artifacts: manifest.artifacts.filter((entry) => entry.path !== "manifest.json"),
  }));
}

/**
 * Assemble a manifest and finalize its self record: the
 * `manifest.json` entry carries the self digest plus the exact stored
 * document length (converged by fixed-point iteration on the
 * fixed-width digest field). Returns the manifest together with the
 * exact bytes to store as `manifest.json`.
 */
export function finalizeKitManifest(input: KitManifestRequest): { manifest: KitManifest; manifestDoc: Uint8Array } {
  const manifest = assembleKitManifest(input);
  const self = manifest.artifacts.find((entry) => entry.path === "manifest.json");
  if (self === undefined) throw invalid("Kit manifest has no manifest.json record.");
  self.sha256 = manifestSelfDigest(manifest);
  for (let round = 0; round < 10; round += 1) {
    const doc = canonicalJsonBytes(manifest);
    if (self.bytes === doc.byteLength) return { manifest, manifestDoc: doc };
    self.bytes = doc.byteLength;
  }
  throw invalid("Kit manifest self record did not converge.");
}

export interface KitPackage {
  zip: Uint8Array;
  sha256: string;
  entryCount: number;
  bytesTotal: number;
}

export interface ParsedKitEntry {
  path: string;
  bytes: number;
  crc32: number;
  data: Uint8Array;
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

/**
 * Build the kit ZIP. `documents` maps artifact path to exact file bytes
 * and MUST contain exactly the shippable set: every shippable path
 * present, nothing else.
 */
export function buildKitPackage(
  manifest: KitManifest,
  documents: Record<string, Uint8Array>,
): KitPackage {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw invalid("Kit manifest must be an object.");
  }
  if (typeof documents !== "object" || documents === null || Array.isArray(documents)) {
    throw invalid("Kit documents must be an object.");
  }
  const { shippable, withheld } = partitionKitArtifacts(manifest);
  if (shippable.length === 0) throw invalid("Kit has no shippable artifacts.");
  if (shippable.length > MAX_ZIP_ENTRIES) throw invalid("Kit exceeds the packaging entry budget.");
  for (const path of withheld) {
    if (Object.hasOwn(documents, path)) {
      throw invalid(`Withheld bytes for ${path} must not enter packaging.`);
    }
  }
  const names = Object.keys(documents);
  for (const path of names) {
    if (!shippable.includes(path)) throw invalid(`Document ${path} is not a shippable manifest artifact.`);
  }
  const byPath = new Map(manifest.artifacts.map((entry) => [entry.path, entry]));
  const ordered = [...shippable].sort();
  let bytesTotal = 0;
  const metas = ordered.map((path) => {
    const record = byPath.get(path);
    const data = documents[path];
    if (record === undefined || data === undefined) throw invalid(`Shippable artifact ${path} has no document.`);
    if (!(data instanceof Uint8Array)) throw invalid(`Document ${path} must be bytes.`);
    if (path === "manifest.json") {
      if (record.sha256 !== manifestSelfDigest(manifest)) {
        throw invalid("Document manifest.json does not match its manifest self record.");
      }
      const expected = canonicalJsonBytes(manifest);
      if (data.byteLength !== record.bytes || data.byteLength !== expected.byteLength) {
        throw invalid("Document manifest.json does not match its manifest self record.");
      }
      for (let i = 0; i < expected.byteLength; i += 1) {
        if (data[i] !== expected[i]) {
          throw invalid("Document manifest.json does not match its manifest self record.");
        }
      }
    } else if (data.byteLength !== record.bytes || sha256HexBytes(data) !== record.sha256) {
      throw invalid(`Document ${path} does not match its manifest record.`);
    }
    bytesTotal += data.byteLength;
    return { path, data, crc: crc32Bytes(data) };
  });
  if (bytesTotal > manifest.capture_scope.max_bytes) {
    throw invalid("Kit payload exceeds the scope byte budget.");
  }

  const encoded = metas.map((meta) => ({ ...meta, name: new TextEncoder().encode(meta.path) }));
  let offset = 0;
  for (const meta of encoded) offset += 30 + meta.name.byteLength + meta.data.byteLength;
  const centralStart = offset;
  for (const meta of encoded) offset += 46 + meta.name.byteLength;
  const centralSize = offset - centralStart;
  const totalSize = offset + 22;
  const zip = new Uint8Array(totalSize);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let cursor = 0;
  const headerOffsets: number[] = [];
  for (const meta of encoded) {
    headerOffsets.push(cursor);
    writeU32(view, cursor, 0x04034b50); cursor += 4;
    writeU16(view, cursor, 20); cursor += 2;
    writeU16(view, cursor, 0x0800); cursor += 2;
    writeU16(view, cursor, 0); cursor += 2;
    writeU16(view, cursor, FIXED_DOS_TIME); cursor += 2;
    writeU16(view, cursor, FIXED_DOS_DATE); cursor += 2;
    writeU32(view, cursor, meta.crc); cursor += 4;
    writeU32(view, cursor, meta.data.byteLength); cursor += 4;
    writeU32(view, cursor, meta.data.byteLength); cursor += 4;
    writeU16(view, cursor, meta.name.byteLength); cursor += 2;
    writeU16(view, cursor, 0); cursor += 2;
    zip.set(meta.name, cursor); cursor += meta.name.byteLength;
    zip.set(meta.data, cursor); cursor += meta.data.byteLength;
  }
  encoded.forEach((meta, index) => {
    writeU32(view, cursor, 0x02014b50); cursor += 4;
    writeU16(view, cursor, 63); cursor += 2;
    writeU16(view, cursor, 20); cursor += 2;
    writeU16(view, cursor, 0x0800); cursor += 2;
    writeU16(view, cursor, 0); cursor += 2;
    writeU16(view, cursor, FIXED_DOS_TIME); cursor += 2;
    writeU16(view, cursor, FIXED_DOS_DATE); cursor += 2;
    writeU32(view, cursor, meta.crc); cursor += 4;
    writeU32(view, cursor, meta.data.byteLength); cursor += 4;
    writeU32(view, cursor, meta.data.byteLength); cursor += 4;
    writeU16(view, cursor, meta.name.byteLength); cursor += 2;
    writeU16(view, cursor, 0); cursor += 2;
    writeU16(view, cursor, 0); cursor += 2;
    writeU16(view, cursor, 0); cursor += 2;
    writeU16(view, cursor, 0); cursor += 2;
    writeU32(view, cursor, EXT_ATTR_FILE); cursor += 4;
    writeU32(view, cursor, headerOffsets[index] as number); cursor += 4;
    zip.set(meta.name, cursor); cursor += meta.name.byteLength;
  });
  writeU32(view, cursor, 0x06054b50); cursor += 4;
  writeU16(view, cursor, 0); cursor += 2;
  writeU16(view, cursor, 0); cursor += 2;
  writeU16(view, cursor, encoded.length); cursor += 2;
  writeU16(view, cursor, encoded.length); cursor += 2;
  writeU32(view, cursor, centralSize); cursor += 4;
  writeU32(view, cursor, centralStart); cursor += 4;
  writeU16(view, cursor, 0); cursor += 2;
  if (cursor !== totalSize) throw invalid("Kit packaging size accounting failed.");

  return { zip, sha256: sha256HexBytes(zip), entryCount: encoded.length, bytesTotal };
}

/** Read a little-endian u16/u32 from bytes with bounds checks. */
function readU16(data: Uint8Array, offset: number): number {
  if (offset + 2 > data.length) throw invalid("Kit ZIP is truncated.");
  return (data[offset] as number) | ((data[offset + 1] as number) << 8);
}

function readU32(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) throw invalid("Kit ZIP is truncated.");
  return (((data[offset] as number) | ((data[offset + 1] as number) << 8) |
    ((data[offset + 2] as number) << 16) | ((data[offset + 3] as number) << 24)) >>> 0);
}

/**
 * Parse and verify a kit ZIP: signature walk, central-directory
 * cross-check, per-entry CRC verification. Returns entries in archive
 * order. Anything malformed fails closed; CRC mismatch is reported
 * as corruption, never trusted.
 */
export function parseKitPackage(zip: Uint8Array): ParsedKitEntry[] {
  if (!(zip instanceof Uint8Array) || zip.byteLength < 22) throw invalid("Kit ZIP is too small.");
  const endOffset = zip.byteLength - 22;
  if (readU32(zip, endOffset) !== 0x06054b50) throw invalid("Kit ZIP end record is missing.");
  const count = readU16(zip, endOffset + 10);
  const centralSize = readU32(zip, endOffset + 12);
  const centralStart = readU32(zip, endOffset + 16);
  if (centralStart + centralSize + 22 !== zip.byteLength) {
    throw invalid("Kit ZIP central directory does not match its length.");
  }
  const entries: ParsedKitEntry[] = [];
  let cursor = centralStart;
  for (let i = 0; i < count; i += 1) {
    if (readU32(zip, cursor) !== 0x02014b50) throw invalid("Kit ZIP central entry is corrupt.");
    const method = readU16(zip, cursor + 10);
    const crc = readU32(zip, cursor + 16);
    const size = readU32(zip, cursor + 20);
    const nameLen = readU16(zip, cursor + 28);
    const extraLen = readU16(zip, cursor + 30);
    const commentLen = readU16(zip, cursor + 32);
    const headerOffset = readU32(zip, cursor + 42);
    const nameBytes = zip.slice(cursor + 46, cursor + 46 + nameLen);
    const path = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    if (
      path.length === 0 || path.length > 256 || path.startsWith("/") ||
      path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      throw invalid(`Kit entry path ${path} is not safe.`);
    }
    if (method !== 0) throw invalid(`Kit entry ${path} uses an unsupported method.`);
    if (readU32(zip, headerOffset) !== 0x04034b50) throw invalid(`Kit entry ${path} has no local header.`);
    const localNameLen = readU16(zip, headerOffset + 26);
    const localExtraLen = readU16(zip, headerOffset + 28);
    const dataStart = headerOffset + 30 + localNameLen + localExtraLen;
    const data = zip.slice(dataStart, dataStart + size);
    if (data.byteLength !== size) throw invalid(`Kit entry ${path} is truncated.`);
    if (crc32Bytes(data) !== crc) {
      throw new KitPackageError("kit-package/corrupt", `Kit entry ${path} failed CRC verification.`);
    }
    entries.push({ path, bytes: size, crc32: crc, data });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  if (cursor !== centralStart + centralSize) throw invalid("Kit ZIP central directory is malformed.");
  return entries;
}
