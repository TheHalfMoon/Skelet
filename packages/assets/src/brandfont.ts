import { createHash } from "node:crypto";
import type { DbClient, DbTransaction } from "../../db/src/db.ts";
import { registerImport } from "../../db/src/workflows.ts";
import { IconSetError, assertSafeSvgBody } from "./iconset.ts";
import { registerAsset } from "./registry.ts";

/**
 * G06-03 brand-mark and font ingestion: trademark-separated logo records
 * with variant inventories, and metadata-only font records with
 * style/weight inventories. Fixture-first like the icon importer: no
 * donor corpus is activated by this grain.
 *
 * Brand posture: every logo record carries trademark=true with its
 * guideline URL recorded separately from the code/content license, so
 * brand marks never resolve to downloadable bytes. Font posture: only
 * metadata is indexed; font files are never served merely because
 * metadata exists. Both paths are dry-runnable, failure-isolated per
 * entry, and idempotent through import records.
 */

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
const MAX_BODY_CHARS = 64 * 1024;
const MAX_VARIANTS = 8;
const MAX_STYLES = 32;
const VERSION = /^[A-Za-z0-9._-]{1,128}$/;

function fail(message: string): never {
  throw new IconSetError(message);
}

export interface BrandVariantInput {
  name: string;
  svgBody: string;
}

export interface BrandMarkInput {
  slug: string;
  title: string;
  guidelinesUrl?: string;
  license?: string;
  variants: BrandVariantInput[];
}

export interface FontStyleInput {
  name: string;
  weight: number;
  style: string;
}

export interface FontFamilyInput {
  family: string;
  license?: string;
  sourceUrl?: string;
  styles: FontStyleInput[];
}

export interface BrandFontResult {
  version: string;
  total: number;
  imported: string[];
  skipped: string[];
  rejected: Array<{ name: string; reason: string }>;
  dryRun: boolean;
}

function validateSlug(slug: string): string {
  if (typeof slug !== "string" || !SLUG.test(slug) || RESERVED.has(slug)) {
    fail("Brand slug is invalid.");
  }
  return slug;
}

function validateGuidelinesUrl(url: string | undefined, label: string): string | undefined {
  if (url === undefined) return undefined;
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = "";
  }
  if (url.length > 2048 || host.length === 0 || !(url.startsWith("http://") || url.startsWith("https://"))) {
    fail(`${label} guidelines URL is invalid.`);
  }
  return url;
}

function validateLicense(license: string | undefined): string {
  if (license === undefined) return "unknown";
  if (typeof license !== "string" || license.trim().length === 0 || license.length > 64) {
    fail("License is invalid.");
  }
  return license.trim();
}

function validateVariant(variant: unknown, label: string): { name: string; body: string } {
  if (typeof variant !== "object" || variant === null) fail(`${label} variant is invalid.`);
  const entry = variant as Record<string, unknown>;
  if (typeof entry.name !== "string" || entry.name.trim().length === 0 || entry.name.length > 64) {
    fail(`${label} variant name is invalid.`);
  }
  rejectControls(entry.name, label);
  if (typeof entry.svgBody !== "string" || entry.svgBody.length === 0 || entry.svgBody.length > MAX_BODY_CHARS) {
    fail(`${label} variant body is invalid.`);
  }
  assertSafeSvgBody(entry.svgBody, label);
  return { name: (entry.name as string).trim(), body: entry.svgBody as string };
}

function validateStyle(style: unknown, label: string): { name: string; weight: number; style: string } {
  if (typeof style !== "object" || style === null) fail(`${label} style is invalid.`);
  const entry = style as Record<string, unknown>;
  if (typeof entry.name !== "string" || entry.name.trim().length === 0 || entry.name.length > 128) {
    fail(`${label} style name is invalid.`);
  }
  rejectControls(entry.name, label);
  if (!Number.isInteger(entry.weight) || (entry.weight as number) < 1 || (entry.weight as number) > 1000) {
    fail(`${label} style weight is invalid.`);
  }
  if (typeof entry.style !== "string" || !["normal", "italic", "oblique"].includes(entry.style)) {
    fail(`${label} font style is invalid.`);
  }
  return { name: (entry.name as string).trim(), weight: entry.weight as number, style: entry.style as string };
}

function descriptorHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

function rejectControls(value: string, label: string): void {
  // eslint-disable-next-line no-control-regex
  if (/[<>&\0-\x1F\x7F]/.test(value)) {
    fail(`${label} contains unsafe characters.`);
  }
}

/**
 * Import brand marks. Every record is trademark-claimed by construction:
 * the trademark flag is not caller-configurable.
 */
export async function importBrandMarks(
  db: DbClient,
  input: {
    sourceId: string;
    version: string;
    rightsClassification: string;
    marks: BrandMarkInput[];
    dryRun?: boolean;
  },
): Promise<BrandFontResult> {
  if (typeof input.version !== "string" || !VERSION.test(input.version)) fail("Version is invalid.");
  if (!["unknown", "metadata_only", "permitted", "restricted"].includes(input.rightsClassification)) {
    fail("Rights classification is invalid.");
  }
  if (!Array.isArray(input.marks) || input.marks.length === 0 || input.marks.length > 1000) {
    fail("Brand mark list is invalid.");
  }
  const result: BrandFontResult = {
    version: input.version,
    total: input.marks.length,
    imported: [],
    skipped: [],
    rejected: [],
    dryRun: input.dryRun ?? false,
  };
  const plans: Array<{
    slug: string;
    title: string;
    guidelinesUrl?: string;
    license: string;
    variants: Array<{ name: string; body: string }>;
  }> = [];
  for (const mark of input.marks) {
    try {
      if (typeof mark !== "object" || mark === null) fail("Brand mark is invalid.");
      const slug = validateSlug((mark as BrandMarkInput).slug);
      const title = (mark as BrandMarkInput).title;
      if (typeof title !== "string" || title.trim().length === 0 || title.length > 500) {
        fail(`Brand ${slug} title is invalid.`);
      }
      rejectControls(title, `Brand ${slug}`);
      const guidelinesUrl = validateGuidelinesUrl(
        (mark as BrandMarkInput).guidelinesUrl,
        `Brand ${slug}`,
      );
      const variants = (mark as BrandMarkInput).variants;
      if (!Array.isArray(variants) || variants.length === 0 || variants.length > MAX_VARIANTS) {
        fail(`Brand ${slug} variants are invalid.`);
      }
      const parsed = variants.map((variant) => validateVariant(variant, `Brand ${slug}`));
      const variantNames = parsed.map((variant) => variant.name);
      if (new Set(variantNames).size !== variantNames.length) {
        fail(`Brand ${slug} variant names must be unique.`);
      }
      plans.push({
        slug,
        title: title.trim(),
        ...(guidelinesUrl === undefined ? {} : { guidelinesUrl }),
        license: validateLicense((mark as BrandMarkInput).license),
        variants: parsed,
      });
    } catch (error) {
      const name =
        typeof (mark as BrandMarkInput)?.slug === "string"
          ? (mark as BrandMarkInput).slug.slice(0, 64)
          : "unknown";
      result.rejected.push({
        name,
        reason: error instanceof IconSetError ? error.message : "Brand mark is invalid.",
      });
    }
  }
  if (result.dryRun) return result;

  for (const plan of plans) {
    const externalId = `brand:${plan.slug}`;
    try {
      await db.transaction(async (tx: DbTransaction) => {
        const existing = await tx.query(
          `select canonical_id from import_records
           where source_id = $1 and external_id = $2 and source_version = $3`,
          [input.sourceId, externalId, input.version],
        );
        if (existing.rows.length > 0) {
          result.skipped.push(plan.slug);
          return;
        }
        const variantNames = plan.variants.map((variant) => variant.name);
        const bodyHashes = plan.variants
          .map((variant) => createHash("sha256").update(variant.body, "utf8").digest("hex"))
          .sort();
        const record = await registerAsset(tx, {
          kind: "logo",
          title: plan.title,
          sourceId: input.sourceId,
          contentHash: descriptorHash([
            "brand",
            plan.slug,
            ...[...variantNames].sort(),
            ...bodyHashes,
          ]),
          rightsClassification: input.rightsClassification,
          metadata: {
            collection: "brand-corpus",
            ref: plan.slug,
            tags: [plan.slug.toLowerCase(), "brand", "logo"],
            license: plan.license,
            trademark: true,
            ...(plan.guidelinesUrl === undefined ? {} : { trademarkGuidelinesUrl: plan.guidelinesUrl }),
            variants: variantNames,
          },
        });
        await registerImport(tx, {
          sourceId: input.sourceId,
          externalId,
          sourceVersion: input.version,
          canonicalType: "artifact",
          canonicalId: record.artifactId,
        });
        result.imported.push(plan.slug);
      });
    } catch (error) {
      // Commit-phase failures stay generic: constraint text must not leak
      // internals to callers. Validation failures keep their codes above.
      result.rejected.push({
        name: plan.slug,
        reason: error instanceof IconSetError ? error.message : "Import failed.",
      });
    }
  }
  return result;
}

/**
 * Import font families as metadata-only records. Font files are never
 * stored or served by this path: indexing metadata must never imply a
 * redistribution right.
 */
export async function importFonts(
  db: DbClient,
  input: {
    sourceId: string;
    version: string;
    rightsClassification: string;
    families: FontFamilyInput[];
    dryRun?: boolean;
  },
): Promise<BrandFontResult> {
  if (typeof input.version !== "string" || !VERSION.test(input.version)) fail("Version is invalid.");
  if (!["unknown", "metadata_only", "permitted", "restricted"].includes(input.rightsClassification)) {
    fail("Rights classification is invalid.");
  }
  if (!Array.isArray(input.families) || input.families.length === 0 || input.families.length > 1000) {
    fail("Font family list is invalid.");
  }
  const result: BrandFontResult = {
    version: input.version,
    total: input.families.length,
    imported: [],
    skipped: [],
    rejected: [],
    dryRun: input.dryRun ?? false,
  };
  const plans: Array<{
    family: string;
    license: string;
    sourceUrl?: string;
    styles: Array<{ name: string; weight: number; style: string }>;
  }> = [];
  for (const family of input.families) {
    try {
      if (typeof family !== "object" || family === null) fail("Font family is invalid.");
      const entry = family as FontFamilyInput;
      if (typeof entry.family !== "string" || entry.family.trim().length === 0 || entry.family.length > 128) {
        fail("Font family name is invalid.");
      }
      rejectControls(entry.family, "Font family");
      if (entry.sourceUrl !== undefined) {
        let host = "";
        try {
          host = new URL(entry.sourceUrl).host;
        } catch {
          host = "";
        }
        if (
          entry.sourceUrl.length > 2048 ||
          host.length === 0 ||
          !(entry.sourceUrl.startsWith("http://") || entry.sourceUrl.startsWith("https://"))
        ) {
          fail(`Font ${entry.family} source URL is invalid.`);
        }
      }
      if (!Array.isArray(entry.styles) || entry.styles.length === 0 || entry.styles.length > MAX_STYLES) {
        fail(`Font ${entry.family} styles are invalid.`);
      }
      const parsed = entry.styles.map((style) => validateStyle(style, `Font ${entry.family}`));
      const styleKeys = parsed.map((style) => `${style.name}:${style.weight}:${style.style}`);
      if (new Set(styleKeys).size !== styleKeys.length) {
        fail(`Font ${entry.family} styles must be unique.`);
      }
      plans.push({
        family: entry.family.trim(),
        license: validateLicense(entry.license),
        ...(entry.sourceUrl === undefined ? {} : { sourceUrl: entry.sourceUrl }),
        styles: parsed,
      });
    } catch (error) {
      const name =
        typeof (family as FontFamilyInput)?.family === "string"
          ? (family as FontFamilyInput).family.slice(0, 64)
          : "unknown";
      result.rejected.push({
        name,
        reason: error instanceof IconSetError ? error.message : "Font family is invalid.",
      });
    }
  }
  if (result.dryRun) return result;

  for (const plan of plans) {
    const externalId = `font:${plan.family.toLowerCase()}`;
    try {
      await db.transaction(async (tx: DbTransaction) => {
        const existing = await tx.query(
          `select canonical_id from import_records
           where source_id = $1 and external_id = $2 and source_version = $3`,
          [input.sourceId, externalId, input.version],
        );
        if (existing.rows.length > 0) {
          result.skipped.push(plan.family);
          return;
        }
        const styleKeys = plan.styles.map((style) => `${style.name}:${style.weight}:${style.style}`);
        const record = await registerAsset(tx, {
          kind: "font",
          title: plan.family,
          sourceId: input.sourceId,
          contentHash: descriptorHash(["font", plan.family.toLowerCase(), ...[...styleKeys].sort()]),
          rightsClassification: input.rightsClassification,
          metadata: {
            collection: "font-corpus",
            ref: plan.family,
            tags: [plan.family.toLowerCase(), "font", "typeface"],
            license: plan.license,
            trademark: false,
            variants: plan.styles.map((style) => `${style.name}:${style.weight}:${style.style}`),
          },
        });
        await registerImport(tx, {
          sourceId: input.sourceId,
          externalId,
          sourceVersion: input.version,
          canonicalType: "artifact",
          canonicalId: record.artifactId,
        });
        result.imported.push(plan.family);
      });
    } catch (error) {
      result.rejected.push({
        name: plan.family,
        reason: error instanceof IconSetError ? error.message : "Import failed.",
      });
    }
  }
  return result;
}
