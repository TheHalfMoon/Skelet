import { createHash } from "node:crypto";
import type { DbClient } from "../../db/src/db.ts";
import {
  ARTIFACT_KINDS,
  RIGHTS,
  createArtifact,
  createAsset,
  type ArtifactKind,
  type Rights,
} from "../../db/src/graph.ts";
import {
  LocalContentAddressedStorage,
  type StorageProvider,
} from "../../storage/src/storage.ts";
import {
  ProviderError,
  invokeProvider,
  type ProviderDefinition,
} from "../../providers/src/provider.ts";

/**
 * G05-03 publish transaction: raw input -> required validation -> asset
 * dedupe -> canonical publish, with optional enrichment reported but
 * never merged into canonical rows.
 *
 * Ordering and failure contract: required validation (shapes, rights,
 * source/product/version coherence) runs before any write; the asset
 * bytes are content-addressed through storage; artifact and asset rows
 * commit atomically. Any required failure throws PublishError with zero
 * new canonical rows. Optional enricher failures yield an explicit
 * partial status with per-provider outcomes; the canonical publish
 * stands unmodified. Storage objects are content-verified and inert:
 * a database rollback after a successful put leaves no false published
 * object, only an unreferenced, garbage-collectable blob.
 */

export type PublishStatus = "published" | "partial";

export interface EnrichmentOutcome {
  providerId: string;
  capability: string;
  ok: boolean;
  errorCode?: string;
}

export interface PublishResult {
  status: PublishStatus;
  artifactId: string;
  assetId: string | null;
  assetDeduplicated: boolean;
  enrichment: EnrichmentOutcome[];
}

export class PublishError extends Error {
  readonly code:
    | "publish/invalid-input"
    | "publish/unknown-reference"
    | "publish/storage-failed";
  constructor(
    code: PublishError["code"],
    message: string,
  ) {
    super(message);
    this.name = "PublishError";
    this.code = code;
  }
}

export interface PublishAssetInput {
  bytes: Uint8Array;
  mediaType: string;
  sourceUrl?: string;
}

export interface PublishInput {
  sourceId: string;
  kind: string;
  title: string;
  rightsClassification: string;
  productId?: string;
  productVersionId?: string;
  summary?: string;
  canonicalText?: string;
  metadata?: Record<string, unknown>;
  asset?: PublishAssetInput;
  enrichers?: Array<ProviderDefinition<unknown, unknown>>;
  enricherTimeoutMs?: number;
  storageMaxBytes?: number;
}

export type { StorageProvider };
export { LocalContentAddressedStorage };

function validateKind(kind: string): ArtifactKind {
  if (!(ARTIFACT_KINDS as readonly string[]).includes(kind)) {
    throw new PublishError("publish/invalid-input", "Artifact kind is invalid.");
  }
  return kind as ArtifactKind;
}

function validateRights(rights: string): Rights {
  if (!(RIGHTS as readonly string[]).includes(rights)) {
    throw new PublishError("publish/invalid-input", "Rights classification is invalid.");
  }
  return rights as Rights;
}

function validateTitle(title: string): string {
  if (typeof title !== "string" || title.trim().length === 0 || title.length > 500) {
    throw new PublishError("publish/invalid-input", "Artifact title is invalid.");
  }
  return title.trim();
}

function validateMediaType(mediaType: string): string {
  if (typeof mediaType !== "string" || !/^[a-z]+\/[a-z0-9.+-]+$/i.test(mediaType)) {
    throw new PublishError("publish/invalid-input", "Asset media type is invalid.");
  }
  return mediaType;
}

async function* singleChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Publish one artifact with its optional asset through the normalized
 * pipeline. Required failures throw with nothing published; optional
 * enrichment failures downgrade the result to partial.
 */
export async function publishArtifact(
  db: DbClient,
  storage: StorageProvider,
  input: PublishInput,
): Promise<PublishResult> {
  const kind = validateKind(input.kind);
  const title = validateTitle(input.title);
  const rights = validateRights(input.rightsClassification);
  if (input.asset !== undefined) {
    validateMediaType(input.asset.mediaType);
    if (!(input.asset.bytes instanceof Uint8Array) || input.asset.bytes.length === 0) {
      throw new PublishError("publish/invalid-input", "Asset bytes are invalid.");
    }
  }
  const timeoutMs = input.enricherTimeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) {
    throw new PublishError("publish/invalid-input", "Enricher timeout is invalid.");
  }

  const published = await db.transaction(async (tx) => {
    const source = await tx.query("select id from sources where id = $1", [input.sourceId]);
    if (source.rows.length === 0) {
      throw new PublishError("publish/unknown-reference", "Source was not found.");
    }
    if (input.productId !== undefined) {
      const product = await tx.query(
        "select id, source_id from products where id = $1",
        [input.productId],
      );
      const productRow = product.rows[0];
      if (productRow === undefined || String(productRow.source_id) !== input.sourceId) {
        throw new PublishError("publish/unknown-reference", "Product was not found.");
      }
    }
    if (input.productVersionId !== undefined) {
      if (input.productId === undefined) {
        throw new PublishError(
          "publish/invalid-input",
          "Product version requires its product.",
        );
      }
      const version = await tx.query(
        "select id, product_id from product_versions where id = $1",
        [input.productVersionId],
      );
      const versionRow = version.rows[0];
      if (versionRow === undefined || String(versionRow.product_id) !== input.productId) {
        throw new PublishError("publish/unknown-reference", "Product version was not found.");
      }
    }

    let assetId: string | null = null;
    let assetDeduplicated = false;
    let contentHash = sha256Hex(Buffer.from(`skelet:${kind}:${title}`));
    if (input.asset !== undefined) {
      let stored;
      try {
        const putOptions =
          input.storageMaxBytes === undefined ? {} : { maxBytes: input.storageMaxBytes };
        stored = await storage.put(singleChunk(input.asset.bytes), putOptions);
      } catch (error) {
        throw new PublishError(
          "publish/storage-failed",
          error instanceof Error ? error.message : "Asset storage failed.",
        );
      }
      contentHash = stored.sha256;
      const asset = await createAsset(tx, {
        sha256: stored.sha256,
        mediaType: input.asset.mediaType,
        byteLength: stored.byteLength,
        storageKey: stored.storageKey,
        sourceId: input.sourceId,
        rightsClassification: rights,
        sourceUrl: input.asset.sourceUrl,
      });
      assetId = asset.id;
      assetDeduplicated = !stored.created;
    }

    const artifact = await createArtifact(tx, {
      kind,
      title,
      sourceId: input.sourceId,
      contentHash,
      rightsClassification: rights,
      productId: input.productId,
      productVersionId: input.productVersionId,
      summary: input.summary,
      canonicalText: input.canonicalText,
      metadata: input.metadata,
    });
    return { artifactId: artifact.id, assetId, assetDeduplicated };
  });

  const enrichment: EnrichmentOutcome[] = [];
  for (const enricher of input.enrichers ?? []) {
    try {
      await invokeProvider(enricher, { artifactId: published.artifactId }, { timeoutMs });
      enrichment.push({
        providerId: enricher.id,
        capability: enricher.capability,
        ok: true,
      });
    } catch (error) {
      enrichment.push({
        providerId: enricher.id,
        capability: enricher.capability,
        ok: false,
        errorCode:
          error instanceof ProviderError ? error.code : "provider/failed",
      });
    }
  }

  return {
    status: enrichment.some((entry) => !entry.ok) ? "partial" : "published",
    ...published,
    enrichment,
  };
}
