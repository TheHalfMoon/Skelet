import type { DbTransaction } from "../../db/src/db.ts";
import {
  createArtifact,
  createAsset,
  type ArtifactKind,
} from "../../db/src/graph.ts";

/**
 * G06-01 asset registry: unified metadata, search, and rights-gated
 * resolution for icons, logos, and fonts over the canonical
 * artifact/asset graph. No new tables: registry fields live in artifact
 * metadata, provenance in source bindings, and byte identity in the
 * content-addressed asset store.
 *
 * Serving posture is fail-closed: only records with permitted rights, a
 * redistributable license, and no trademark claim resolve to downloadable
 * bytes. Everything else resolves to metadata-only with an explicit
 * reason. A result without provenance and a serving policy is incomplete
 * by product contract, so both are always attached.
 */

export type RegistryKind = "icon" | "logo" | "font";
export type ServingDecision = "download" | "metadata-only";

const REGISTRY_KINDS: readonly string[] = ["icon", "logo", "font"];

/**
 * Licenses whose terms permit redistribution of the bytes. Anything
 * else — including unknown and attribution-conditional licenses, which
 * need per-use handling this grain does not model — resolves to
 * metadata-only.
 */
const REDISTRIBUTABLE_LICENSES: readonly string[] = [
  "MIT",
  "Apache-2.0",
  "ISC",
  "CC0-1.0",
  "OFL-1.1",
];

export interface RegistryMetadata {
  /** Collection identity, e.g. "iconify:mdi" or "fontsource". */
  collection?: string;
  /** Collection-scoped name, e.g. "arrow-right" or "Inter". */
  ref?: string;
  /** Searchable aliases; bounded at registration. */
  tags?: string[];
  /** SPDX identifier or "unknown". */
  license?: string;
  /** Brand/trademark claim; when true, bytes never serve. */
  trademark?: boolean;
  /** Brand-guideline URL, recorded separately from code license. */
  trademarkGuidelinesUrl?: string;
  /** Known variants, e.g. light/dark/monochrome/wordmark. */
  variants?: string[];
}

export interface AssetRecord {
  artifactId: string;
  kind: RegistryKind;
  title: string;
  summary: string | null;
  collection: string | null;
  ref: string | null;
  tags: string[];
  license: string;
  trademark: boolean;
  trademarkGuidelinesUrl: string | null;
  variants: string[];
  rightsClassification: string;
  visibility: string;
  sourceKey: string;
  contentHash: string;
  serving: ServingDecision;
  servingReason: string;
}

export class RegistryError extends Error {
  readonly code: "assets/invalid-record" | "assets/not-found";
  constructor(code: RegistryError["code"], message: string) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
  }
}

const MAX_TAGS = 20;
const MAX_TAG_CHARS = 64;
const MAX_TEXT_CHARS = 500;
const MAX_VARIANTS = 12;

function validateRegistryMetadata(metadata: unknown): RegistryMetadata {
  if (metadata === undefined || metadata === null) return {};
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new RegistryError("assets/invalid-record", "Asset metadata is invalid.");
  }
  const record = metadata as Record<string, unknown>;
  const validated: RegistryMetadata = {};
  if (record.collection !== undefined) {
    if (typeof record.collection !== "string" || record.collection.length > MAX_TEXT_CHARS) {
      throw new RegistryError("assets/invalid-record", "Asset collection is invalid.");
    }
    validated.collection = record.collection;
  }
  if (record.ref !== undefined) {
    if (typeof record.ref !== "string" || record.ref.length === 0 || record.ref.length > MAX_TEXT_CHARS) {
      throw new RegistryError("assets/invalid-record", "Asset reference is invalid.");
    }
    validated.ref = record.ref;
  }
  if (record.tags !== undefined) {
    if (
      !Array.isArray(record.tags) ||
      record.tags.length > MAX_TAGS ||
      record.tags.some((tag) => typeof tag !== "string" || tag.length === 0 || tag.length > MAX_TAG_CHARS)
    ) {
      throw new RegistryError("assets/invalid-record", "Asset tags are invalid.");
    }
    validated.tags = [...(record.tags as string[])];
  }
  if (record.license !== undefined) {
    if (typeof record.license !== "string" || record.license.length === 0 || record.license.length > 64) {
      throw new RegistryError("assets/invalid-record", "Asset license is invalid.");
    }
    validated.license = record.license;
  }
  if (record.trademark !== undefined) {
    if (typeof record.trademark !== "boolean") {
      throw new RegistryError("assets/invalid-record", "Asset trademark flag is invalid.");
    }
    validated.trademark = record.trademark;
  }
  if (record.trademarkGuidelinesUrl !== undefined) {
    if (
      typeof record.trademarkGuidelinesUrl !== "string" ||
      record.trademarkGuidelinesUrl.length > 2048 ||
      !(
        record.trademarkGuidelinesUrl.startsWith("http://") ||
        record.trademarkGuidelinesUrl.startsWith("https://")
      )
    ) {
      throw new RegistryError("assets/invalid-record", "Trademark guidelines URL is invalid.");
    }
    validated.trademarkGuidelinesUrl = record.trademarkGuidelinesUrl;
  }
  if (record.variants !== undefined) {
    if (
      !Array.isArray(record.variants) ||
      record.variants.length > MAX_VARIANTS ||
      record.variants.some((variant) => typeof variant !== "string" || variant.length > MAX_TEXT_CHARS)
    ) {
      throw new RegistryError("assets/invalid-record", "Asset variants are invalid.");
    }
    validated.variants = [...(record.variants as string[])];
  }
  return validated;
}

function validateKind(kind: string): RegistryKind {
  if (!REGISTRY_KINDS.includes(kind)) {
    throw new RegistryError("assets/invalid-record", "Asset kind is invalid.");
  }
  return kind as RegistryKind;
}

/**
 * Derive the serving policy from rights, license, and trademark state.
 * Fail-closed: unknown licenses, non-permitted rights, and any
 * trademark claim all resolve to metadata-only.
 */
export function servingPolicy(input: {
  rightsClassification: string;
  license: string;
  trademark: boolean;
}): { serving: ServingDecision; reason: string } {
  if (input.trademark) {
    return { serving: "metadata-only", reason: "Trademark claim requires brand-owner permission." };
  }
  if (input.rightsClassification !== "permitted") {
    return {
      serving: "metadata-only",
      reason: `Rights classification ${input.rightsClassification} forbids redistribution.`,
    };
  }
  if (!REDISTRIBUTABLE_LICENSES.includes(input.license)) {
    return {
      serving: "metadata-only",
      reason: `License ${input.license} is not cleared for redistribution.`,
    };
  }
  return { serving: "download", reason: "Permitted rights with a redistributable license." };
}

function toRecord(row: Record<string, unknown>): AssetRecord {
  const metadata = validateRegistryMetadata(
    typeof row.metadata === "string" ? JSON.parse(row.metadata as string) : row.metadata,
  );
  const license = metadata.license ?? "unknown";
  const trademark = metadata.trademark ?? false;
  const rights = String(row.rights_classification);
  const policy = servingPolicy({ rightsClassification: rights, license, trademark });
  return {
    artifactId: String(row.id),
    kind: String(row.kind) as RegistryKind,
    title: String(row.title),
    summary: row.summary === null ? null : String(row.summary),
    collection: metadata.collection ?? null,
    ref: metadata.ref ?? null,
    tags: metadata.tags ?? [],
    license,
    trademark,
    trademarkGuidelinesUrl: metadata.trademarkGuidelinesUrl ?? null,
    variants: metadata.variants ?? [],
    rightsClassification: rights,
    visibility: String(row.visibility),
    sourceKey: String(row.source_key),
    contentHash: String(row.content_hash),
    serving: policy.serving,
    servingReason: policy.reason,
  };
}

const RECORD_COLUMNS =
  `a.id, a.kind, a.title, a.summary, a.metadata, a.rights_classification,
   a.visibility, a.content_hash, s.key as source_key`;

/**
 * Register an asset record. Byte-backed records reference a stored asset
 * hash; metadata-only records (restricted files, unknown licenses) carry
 * an empty content hash of zeros and must never serve bytes.
 */
export async function registerAsset(
  tx: DbTransaction,
  input: {
    kind: string;
    title: string;
    summary?: string;
    sourceId: string;
    productId?: string;
    contentHash: string;
    rightsClassification: string;
    visibility?: string;
    metadata?: unknown;
    asset?: {
      sha256: string;
      mediaType: string;
      byteLength: number;
      storageKey: string;
    };
  },
): Promise<AssetRecord> {
  const kind: ArtifactKind = validateKind(input.kind);
  if (typeof input.title !== "string" || input.title.trim().length === 0 || input.title.length > 500) {
    throw new RegistryError("assets/invalid-record", "Asset title is invalid.");
  }
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) {
    throw new RegistryError("assets/invalid-record", "Content hash is invalid.");
  }
  const metadata = validateRegistryMetadata(input.metadata);
  const rights = String(input.rightsClassification);
  if (!["unknown", "metadata_only", "permitted", "restricted"].includes(rights)) {
    throw new RegistryError("assets/invalid-record", "Rights classification is invalid.");
  }
  const visibility = input.visibility ?? "private";
  if (!["private", "workspace", "public"].includes(visibility)) {
    throw new RegistryError("assets/invalid-record", "Visibility is invalid.");
  }
  if (input.asset !== undefined) {
    if (
      !/^[0-9a-f]{64}$/.test(input.asset.sha256) ||
      typeof input.asset.mediaType !== "string" ||
      !Number.isInteger(input.asset.byteLength) ||
      input.asset.byteLength <= 0 ||
      typeof input.asset.storageKey !== "string" ||
      input.asset.storageKey.length === 0
    ) {
      throw new RegistryError("assets/invalid-record", "Asset bytes reference is invalid.");
    }
    await createAsset(tx, {
      sha256: input.asset.sha256,
      mediaType: input.asset.mediaType,
      byteLength: input.asset.byteLength,
      storageKey: input.asset.storageKey,
      sourceId: input.sourceId,
      rightsClassification: rights as "unknown" | "metadata_only" | "permitted" | "restricted",
    });
  }
  const artifact = await createArtifact(tx, {
    kind,
    title: input.title.trim(),
    sourceId: input.sourceId,
    contentHash: input.contentHash,
    rightsClassification: rights as "unknown" | "metadata_only" | "permitted" | "restricted",
    productId: input.productId,
    summary: input.summary,
    visibility: visibility as "private" | "workspace" | "public",
    metadata: metadata as Record<string, unknown>,
  });
  const record = await tx.query(
    `select ${RECORD_COLUMNS} from artifacts a join sources s on s.id = a.source_id
     where a.id = $1`,
    [artifact.id],
  );
  const row = record.rows[0];
  if (row === undefined) {
    throw new RegistryError("assets/not-found", "Asset record was not found.");
  }
  return toRecord(row);
}

export interface AssetSearch {
  query: string;
  kinds?: RegistryKind[];
  rights?: string[];
  licenses?: string[];
  trademarkFree?: boolean;
  collection?: string;
  limit?: number;
}

const SEARCH_MAX_LIMIT = 50;

/**
 * Unified search across icons, logos, and fonts. Text matches titles,
 * summaries, canonical text, collections, refs, and tags; every result
 * carries provenance and a serving policy.
 */
export async function searchAssets(
  tx: DbTransaction,
  search: AssetSearch,
): Promise<AssetRecord[]> {
  if (typeof search.query !== "string" || search.query.trim().length === 0) {
    throw new RegistryError("assets/invalid-record", "Search query is invalid.");
  }
  const limit = search.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_MAX_LIMIT) {
    throw new RegistryError("assets/invalid-record", "Search limit is invalid.");
  }
  const kinds = search.kinds ?? (["icon", "logo", "font"] as RegistryKind[]);
  for (const kind of kinds) validateKind(kind);
  if (kinds.length === 0) {
    throw new RegistryError("assets/invalid-record", "Asset kinds are invalid.");
  }
  const pattern = `%${search.query.trim().toLowerCase()}%`;
  const params: unknown[] = [pattern];
  const kindPlaceholders = kinds.map((kind) => {
    params.push(kind);
    return `$${params.length}`;
  });
  let rightsFilter = "";
  if (search.rights !== undefined) {
    if (search.rights.length === 0) {
      throw new RegistryError("assets/invalid-record", "Rights filter is invalid.");
    }
    const placeholders = search.rights.map((right) => {
      params.push(right);
      return `$${params.length}`;
    });
    rightsFilter = `and a.rights_classification in (${placeholders.join(", ")})`;
  }
  let licenseFilter = "";
  if (search.licenses !== undefined) {
    if (search.licenses.length === 0) {
      throw new RegistryError("assets/invalid-record", "License filter is invalid.");
    }
    const placeholders = search.licenses.map((license) => {
      params.push(license);
      return `$${params.length}`;
    });
    licenseFilter = `and coalesce(a.metadata->>'license', 'unknown') in (${placeholders.join(", ")})`;
  }
  let trademarkFilter = "";
  if (search.trademarkFree === true) {
    trademarkFilter = `and coalesce((a.metadata->>'trademark')::boolean, false) = false`;
  }
  let collectionFilter = "";
  if (search.collection !== undefined) {
    params.push(search.collection);
    collectionFilter = `and coalesce(a.metadata->>'collection', '') = $${params.length}`;
  }
  params.push(limit);
  const result = await tx.query(
    `select ${RECORD_COLUMNS} from artifacts a join sources s on s.id = a.source_id
     where a.kind in (${kindPlaceholders.join(", ")})
       and (lower(a.title) like $1 or lower(coalesce(a.summary, '')) like $1
         or lower(coalesce(a.canonical_text, '')) like $1
         or lower(coalesce(a.metadata->>'collection', '')) like $1
         or lower(coalesce(a.metadata->>'ref', '')) like $1
         or exists (select 1 from jsonb_array_elements_text(
           case when jsonb_typeof(a.metadata->'tags') = 'array'
             then a.metadata->'tags' else '[]'::jsonb end) as tag
           where lower(tag) like $1))
       ${rightsFilter} ${licenseFilter} ${trademarkFilter} ${collectionFilter}
     order by a.title, a.id limit $${params.length}`,
    params,
  );
  return result.rows.map(toRecord);
}

/**
 * Resolve one record by artifact ID with its serving policy. Downloadable
 * records include the content hash for byte retrieval; metadata-only
 * records never do.
 */
export async function resolveAsset(
  tx: DbTransaction,
  artifactId: string,
): Promise<AssetRecord> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(artifactId)) {
    throw new RegistryError("assets/not-found", "Asset record was not found.");
  }
  const result = await tx.query(
    `select ${RECORD_COLUMNS} from artifacts a join sources s on s.id = a.source_id
     where a.id = $1 and a.kind in ('icon', 'logo', 'font')`,
    [artifactId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new RegistryError("assets/not-found", "Asset record was not found.");
  }
  return toRecord(row);
}
