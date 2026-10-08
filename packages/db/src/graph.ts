import { randomBytes } from "node:crypto";
import type { DbTransaction } from "./db.ts";

export const ARTIFACT_KINDS = [
  "screen", "page", "section", "component", "icon", "logo",
  "font", "illustration", "resource", "brief", "design",
] as const;
export const RIGHTS = ["unknown", "metadata_only", "permitted", "restricted"] as const;
export const VISIBILITIES = ["private", "workspace", "public"] as const;
export const RELATIONS = [
  "contains", "belongs_to", "uses", "derived_from", "visually_similar_to",
  "semantically_similar_to", "appears_in", "follows", "precedes",
  "variant_of", "extracted_from", "references",
] as const;
export const ENTITY_TYPES = [
  "source", "product", "product_version", "artifact", "asset", "pattern",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type Rights = (typeof RIGHTS)[number];
export type Visibility = (typeof VISIBILITIES)[number];
export type RelationType = (typeof RELATIONS)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];
export type Metadata = Record<string, unknown>;

export interface ArtifactInput {
  kind: ArtifactKind;
  title: string;
  sourceId: string;
  contentHash: string;
  rightsClassification: Rights;
  visibility?: Visibility | undefined;
  productId?: string | undefined;
  productVersionId?: string | undefined;
  summary?: string | undefined;
  canonicalText?: string | undefined;
  sourceRecordId?: string | undefined;
  capturedAt?: string | undefined;
  metadata?: Metadata | undefined;
}
export interface Artifact extends ArtifactInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetInput {
  sha256: string;
  mediaType: string;
  byteLength: number;
  storageKey: string;
  sourceId: string;
  rightsClassification: Rights;
  sourceUrl?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  durationMs?: number | undefined;
  metadata?: Metadata | undefined;
}
export interface Asset extends AssetInput {
  id: string;
  createdAt: string;
}
export interface PatternInput {
  slug: string;
  title: string;
  sourceId: string;
  description?: string | undefined;
  metadata?: Metadata | undefined;
}
export interface Pattern extends PatternInput {
  id: string;
  createdAt: string;
}
export interface RelationInput {
  fromType: EntityType;
  fromId: string;
  relationType: RelationType;
  toType: EntityType;
  toId: string;
  confidence?: number | undefined;
  evidence?: Metadata | undefined;
}
export interface Relation extends RelationInput {
  id: string;
  createdAt: string;
}

function rowRequired(rows: Record<string, unknown>[]): Record<string, unknown> {
  const row = rows[0];
  if (!row) throw new Error("Expected a row from the database");
  return row;
}
function time(value: unknown): string {
  const d = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(d.getTime())) throw new Error("Invalid database timestamp");
  return d.toISOString();
}
function optional(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}
function metadata(value: unknown): Metadata {
  if (typeof value === "string") return JSON.parse(value) as Metadata;
  if (value == null) return {};
  return value as Metadata;
}

/** RFC 9562 UUIDv7: sortable millisecond timestamp, random suffix, version/variant bits. */
export function uuidV7(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 281474976710655) {
    throw new RangeError("UUIDv7 timestamp out of range");
  }
  const bytes = randomBytes(16);
  let timestamp = BigInt(now);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(timestamp & 255n);
    timestamp >>= 8n;
  }
  bytes[6] = ((bytes[6] ?? 0) & 15) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 0x80;
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20)].join("-");
}
const artifactColumns = `id,kind,product_id,product_version_id,title,summary,
  canonical_text,metadata,source_id,source_record_id,captured_at,created_at,
  updated_at,content_hash,rights_classification,visibility`;
const assetColumns = `id,sha256,media_type,byte_length,width,height,duration_ms,
  storage_key,source_url,source_id,rights_classification,metadata,created_at`;

function toArtifact(row: Record<string, unknown>): Artifact {
  return {
    id: String(row.id), kind: row.kind as ArtifactKind,
    productId: optional(row.product_id), productVersionId: optional(row.product_version_id),
    title: String(row.title), summary: optional(row.summary),
    canonicalText: optional(row.canonical_text), metadata: metadata(row.metadata),
    sourceId: String(row.source_id), sourceRecordId: optional(row.source_record_id),
    capturedAt: row.captured_at == null ? undefined : time(row.captured_at),
    createdAt: time(row.created_at), updatedAt: time(row.updated_at),
    contentHash: String(row.content_hash), rightsClassification: row.rights_classification as Rights,
    visibility: row.visibility as Visibility,
  };
}
export async function createArtifact(tx: DbTransaction, input: ArtifactInput): Promise<Artifact> {
  const id = uuidV7();
  const result = await tx.query(`insert into artifacts
    (id,kind,product_id,product_version_id,title,summary,canonical_text,metadata,
     source_id,source_record_id,captured_at,content_hash,rights_classification,visibility)
    values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)
    returning ${artifactColumns}`, [
    id,input.kind,input.productId ?? null,input.productVersionId ?? null,
    input.title,input.summary ?? null,input.canonicalText ?? null,
    JSON.stringify(input.metadata ?? {}),input.sourceId,input.sourceRecordId ?? null,
    input.capturedAt ?? null,input.contentHash,input.rightsClassification,
    input.visibility ?? "private",
  ]);
  return toArtifact(rowRequired(result.rows));
}
export async function getArtifact(tx: DbTransaction, id: string): Promise<Artifact | null> {
  const result = await tx.query(`select ${artifactColumns} from artifacts where id=$1`, [id]);
  return result.rows[0] ? toArtifact(result.rows[0]) : null;
}
function toAsset(row: Record<string, unknown>): Asset {
  return {
    id:String(row.id), sha256:String(row.sha256), mediaType:String(row.media_type),
    byteLength:Number(row.byte_length), storageKey:String(row.storage_key),
    sourceId:String(row.source_id), rightsClassification:row.rights_classification as Rights,
    sourceUrl:optional(row.source_url), width:row.width==null?undefined:Number(row.width),
    height:row.height==null?undefined:Number(row.height),
    durationMs:row.duration_ms==null?undefined:Number(row.duration_ms),
    metadata:metadata(row.metadata),createdAt:time(row.created_at),
  };
}
/** First writer owns the SHA-256 record and rights. Dedup never upgrades access. */
export async function createAsset(tx: DbTransaction, input: AssetInput): Promise<Asset> {
  const args = [
    input.sha256,input.mediaType,input.byteLength,input.width ?? null,
    input.height ?? null,input.durationMs ?? null,input.storageKey,
    input.sourceUrl ?? null,input.sourceId,input.rightsClassification,
    JSON.stringify(input.metadata ?? {}),
  ];
  const result = await tx.query(`insert into assets
    (sha256,media_type,byte_length,width,height,duration_ms,storage_key,
     source_url,source_id,rights_classification,metadata)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    on conflict (sha256) do nothing returning ${assetColumns}`, args);
  if (result.rows[0]) return toAsset(result.rows[0]);
  const existing = await tx.query(`select ${assetColumns} from assets where sha256=$1`,
    [input.sha256]);
  const stored = toAsset(rowRequired(existing.rows));
  // Without a per-source rights-claim table we must refuse conflicts rather
  // than silently erase a stricter license or secondary provenance.
  if (stored.sourceId !== input.sourceId ||
      stored.rightsClassification !== input.rightsClassification) {
    throw new Error("Asset provenance or rights conflict for duplicate SHA-256");
  }
  if (stored.mediaType !== input.mediaType ||
      stored.byteLength !== input.byteLength ||
      stored.storageKey !== input.storageKey) {
    throw new Error("Asset metadata conflict for duplicate SHA-256");
  }
  return stored;
}
export async function getAssetByHash(tx: DbTransaction, sha256: string): Promise<Asset | null> {
  const result = await tx.query(`select ${assetColumns} from assets where sha256=$1`, [sha256]);
  return result.rows[0] ? toAsset(result.rows[0]) : null;
}
function toPattern(row: Record<string, unknown>): Pattern {
  return {
    id:String(row.id),slug:String(row.slug),title:String(row.title),
    sourceId:String(row.source_id), description:optional(row.description),
    metadata:metadata(row.metadata), createdAt:time(row.created_at),
  };
}
export async function createPattern(tx: DbTransaction, input: PatternInput): Promise<Pattern> {
  const result = await tx.query(
    `insert into patterns (slug,title,description,source_id,metadata)
     values ($1,$2,$3,$4,$5::jsonb) returning *`,
    [input.slug,input.title,input.description ?? null,input.sourceId,
      JSON.stringify(input.metadata ?? {})],
  );
  return toPattern(rowRequired(result.rows));
}
function toRelation(row: Record<string, unknown>): Relation {
  return {
    id:String(row.id),fromType:row.from_type as EntityType,
    fromId:String(row.from_id),relationType:row.relation_type as RelationType,
    toType:row.to_type as EntityType,toId:String(row.to_id),
    confidence:row.confidence==null?undefined:Number(row.confidence),
    evidence:row.evidence==null?undefined:metadata(row.evidence),
    createdAt:time(row.created_at),
  };
}
export async function createRelation(tx: DbTransaction, input: RelationInput): Promise<Relation> {
  const result = await tx.query(
    `insert into relations
     (from_type,from_id,relation_type,to_type,to_id,confidence,evidence)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb) returning *`,
    [input.fromType,input.fromId,input.relationType,input.toType,input.toId,
      input.confidence ?? null,
      input.evidence ? JSON.stringify(input.evidence) : null],
  );
  return toRelation(rowRequired(result.rows));
}
export async function listRelations(tx: DbTransaction, type: EntityType, id: string):
  Promise<Relation[]> {
  const result = await tx.query(
    `select * from relations where from_type=$1 and from_id=$2
     order by relation_type,to_type,to_id`,[type,id],
  );
  return result.rows.map(toRelation);
}
