import { createHash } from "node:crypto";
import type { DbClient, DbTransaction } from "../../db/src/db.ts";
import { registerImport } from "../../db/src/workflows.ts";
import type { StorageProvider } from "../../storage/src/storage.ts";
import { registerAsset } from "./registry.ts";

/**
 * G06-02 Iconify-compatible icon importer: validates an icon-set JSON
 * document, sanitizes bodies, generates canonical SVGs, registers icon
 * records with collection attribution and license metadata, and maps
 * every icon through idempotent import records.
 *
 * Fixture-first: the mechanism is proven with hand-authored offline
 * fixtures. No donor corpus is activated by this grain; real Iconify
 * collections land in a dedicated import grain with license verification
 * at import time. Set-level license and caller-supplied rights are
 * self-attested and unverified here: they must be verified against
 * provenance before any real-corpus activation.
 */

export interface IconSetIcon {
  body: string;
  width?: number;
  height?: number;
}

export interface IconSetDocument {
  prefix: string;
  icons: Record<string, IconSetIcon>;
  width?: number;
  height?: number;
  info?: {
    name?: string;
    author?: string;
    license?: { title?: string; spdx?: string };
  };
}

export interface IconImportRejection {
  name: string;
  reason: string;
}

export interface IconImportResult {
  prefix: string;
  version: string;
  license: string;
  total: number;
  imported: string[];
  skipped: string[];
  rejected: IconImportRejection[];
  dryRun: boolean;
}

export class IconSetError extends Error {
  readonly code: "assets/invalid-iconset";
  constructor(message: string) {
    super(message);
    this.name = "IconSetError";
    this.code = "assets/invalid-iconset";
  }
}

const MAX_ICONS_PER_SET = 5000;
const MAX_BODY_CHARS = 64 * 1024;
const MAX_SET_BYTES = 16 * 1024 * 1024;
const MAX_DIMENSION = 2048;
const DEFAULT_DIMENSION = 24;
const ICON_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION = /^[A-Za-z0-9._-]{1,128}$/;
const RESERVED_NAMES = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Baseline SVG body sanitizer: blocks active content, embedded payloads,
 * and style-driven vectors. Presentation attributes and inert shapes
 * pass; anything the list does not recognize as inert fails closed.
 * Stored bytes are inert corpus data: any future byte-serve layer MUST
 * release them only in a strictly inert context (img-only consumers with
 * script-src 'none', nosniff, and no privileged same-origin rendering).
 * A full-sanitizer upgrade lands with untrusted-corpus ingestion.
 */
const UNSAFE_BODY = new RegExp(
  "<\\s*(script|foreignobject|iframe|object|embed|link|meta|base|form|style|a|" +
    "image|use|animate|animatetransform|animatemotion|set|video|audio|source|" +
    "handler|listener|discard|symbol)\\b" +
    "|\\bstyle\\s*=" +
    "|on[a-z]+\\s*=" +
    "|javascript\\s*:|vbscript\\s*:|data\\s*:" +
    "|expression\\s*\\(|-moz-binding|behaviour\\s*:",
  "i",
);

function fail(message: string): never {
  throw new IconSetError(message);
}

function validateDocument(document: unknown): IconSetDocument {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    fail("Icon set must be an object.");
  }
  const set = document as Record<string, unknown>;
  if (typeof set.prefix !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(set.prefix)) {
    fail("Icon set prefix is invalid.");
  }
  if (typeof set.icons !== "object" || set.icons === null || Array.isArray(set.icons)) {
    fail("Icon set icons must be an object.");
  }
  const names = Object.keys(set.icons);
  if (names.length === 0 || names.length > MAX_ICONS_PER_SET) {
    fail("Icon set icon count is invalid.");
  }
  for (const dimension of ["width", "height"] as const) {
    const value = set[dimension];
    if (
      value !== undefined &&
      (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > MAX_DIMENSION)
    ) {
      fail(`Icon set ${dimension} is invalid.`);
    }
  }
  return set as unknown as IconSetDocument;
}

function validateIconBody(name: string, body: unknown): string {
  if (typeof body !== "string" || body.length === 0 || body.length > MAX_BODY_CHARS) {
    fail(`Icon ${name} body is invalid.`);
  }
  if (UNSAFE_BODY.test(body)) {
    fail(`Icon ${name} body contains unsafe markup.`);
  }
  return body;
}

function dimension(value: number | undefined, fallback: number | undefined): number {
  if (value !== undefined) {
    if (!Number.isInteger(value) || value <= 0 || value > MAX_DIMENSION) {
      throw new IconSetError("Icon dimensions are invalid.");
    }
    return value;
  }
  return fallback ?? DEFAULT_DIMENSION;
}

function buildSvg(body: string, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

/** Searchable aliases from the icon name; source attribution untouched. */
function aliasTags(name: string): string[] {
  const tags = new Set<string>();
  tags.add(name.toLowerCase());
  for (const part of name.toLowerCase().split(/[-_]+/)) {
    if (part.length >= 2) tags.add(part);
  }
  return [...tags].slice(0, 12);
}

function licenseOf(set: IconSetDocument): string {
  const spdx = set.info?.license?.spdx;
  if (typeof spdx === "string" && spdx.trim().length > 0 && spdx.length <= 64) {
    return spdx.trim();
  }
  return "unknown";
}

async function* singleChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

/**
 * Import an Iconify-compatible icon set. Dry-run validates and reports
 * without writing. Live import is failure-isolated per icon: rejected
 * icons are reported, the rest publish; re-imports skip through import
 * records without duplicating canonical rows.
 */
export async function importIconSet(
  db: DbClient,
  input: {
    sourceId: string;
    setJson: unknown;
    version: string;
    rightsClassification: string;
    storage?: StorageProvider;
    dryRun?: boolean;
  },
): Promise<IconImportResult> {
  const set = validateDocument(input.setJson);
  if (typeof input.version !== "string" || !VERSION.test(input.version)) {
    fail("Icon set version is invalid.");
  }
  if (!["unknown", "metadata_only", "permitted", "restricted"].includes(input.rightsClassification)) {
    fail("Icon set rights classification is invalid.");
  }
  const license = licenseOf(set);
  const names = Object.keys(set.icons);
  const result: IconImportResult = {
    prefix: set.prefix,
    version: input.version,
    license,
    total: names.length,
    imported: [],
    skipped: [],
    rejected: [],
    dryRun: input.dryRun ?? false,
  };

  const plans: Array<{ name: string; body: string; width: number; height: number }> = [];
  let plannedBytes = 0;
  for (const name of names) {
    // Names flow into external IDs, titles, refs, and reports: bound
    // charset and length before any use, and reject reserved keys.
    if (!ICON_NAME.test(name) || RESERVED_NAMES.has(name)) {
      result.rejected.push({ name: name.slice(0, 64), reason: `Icon name is invalid.` });
      continue;
    }
    const icon = (set.icons as Record<string, IconSetIcon>)[name];
    try {
      if (typeof icon !== "object" || icon === null) fail(`Icon ${name} is invalid.`);
      const body = validateIconBody(name, (icon as IconSetIcon).body);
      plannedBytes += body.length;
      if (plannedBytes > MAX_SET_BYTES) {
        fail("Icon set total size is invalid.");
      }
      plans.push({
        name,
        body,
        width: dimension((icon as IconSetIcon).width, set.width),
        height: dimension((icon as IconSetIcon).height, set.height),
      });
    } catch (error) {
      result.rejected.push({
        name,
        reason: error instanceof IconSetError ? error.message : "Icon is invalid.",
      });
    }
  }

  if (result.dryRun) return result;

  for (const plan of plans) {
    const externalId = `${set.prefix}:${plan.name}`;
    try {
      await db.transaction(async (tx: DbTransaction) => {
        const existing = await tx.query(
          `select canonical_id from import_records
           where source_id = $1 and external_id = $2 and source_version = $3`,
          [input.sourceId, externalId, input.version],
        );
        if (existing.rows.length > 0) {
          result.skipped.push(plan.name);
          return;
        }
        const svg = buildSvg(plan.body, plan.width, plan.height);
        const bytes = new TextEncoder().encode(svg);
        const contentHash = createHash("sha256").update(bytes).digest("hex");
        let assetRef: { sha256: string; mediaType: string; byteLength: number; storageKey: string } | undefined;
        if (input.storage !== undefined) {
          const stored = await input.storage.put(singleChunk(bytes));
          assetRef = {
            sha256: stored.sha256,
            mediaType: "image/svg+xml",
            byteLength: stored.byteLength,
            storageKey: stored.storageKey,
          };
        }
        const record = await registerAsset(tx, {
          kind: "icon",
          title: `${set.prefix}:${plan.name}`,
          sourceId: input.sourceId,
          contentHash,
          rightsClassification: input.rightsClassification,
          metadata: {
            collection: `iconify:${set.prefix}`,
            ref: plan.name,
            tags: aliasTags(plan.name),
            license,
          },
          ...(assetRef === undefined ? {} : { asset: assetRef }),
        });
        await registerImport(tx, {
          sourceId: input.sourceId,
          externalId,
          sourceVersion: input.version,
          canonicalType: "artifact",
          canonicalId: record.artifactId,
        });
        result.imported.push(plan.name);
      });
    } catch (error) {
      result.rejected.push({
        name: plan.name,
        reason: error instanceof Error ? error.message.slice(0, 300) : "Import failed.",
      });
    }
  }
  return result;
}
