import type { DbTransaction } from "./db.ts";
import { getArtifactForActor } from "./artifact-access.ts";

/**
 * AF-14d product/version gallery reads (P10 smallest gallery grain).
 *
 * Lists products and versions that have at least one actor-readable
 * artifact, so gallery browsing never leaks titles of fully-withheld
 * corpora. Unknown products and products with zero readable artifacts
 * both read as an empty list (no existence oracle); malformed
 * identifiers fail closed as invalid input.
 *
 * Authorization reuses the AF-SEC-00 central gate per artifact
 * (getArtifactForActor), exactly like the flow listing: a product or
 * version is visible only through readable evidence, never through
 * its own row. Pagination is deterministic (title/id and version_no
 * order) with an examined cap that reports truncated instead of
 * silently dropping candidates.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_OFFSET = 1_000_000;
const MAX_PRODUCTS_EXAMINED = 200;
const MAX_VERSIONS_EXAMINED = 200;

export class GalleryError extends Error {
  readonly code: "gallery/invalid-input";
  constructor(code: GalleryError["code"], message: string) {
    super(message);
    this.name = "GalleryError";
    this.code = code;
  }
}

function fail(message: string): never {
  throw new GalleryError("gallery/invalid-input", message);
}

export interface GalleryProduct {
  productId: string;
  title: string;
  versionCount: number;
  artifactCount: number;
}

export interface GalleryVersion {
  versionId: string;
  productId: string;
  versionNo: number;
  artifactCount: number;
}

async function readableArtifactIds(
  tx: DbTransaction,
  where: string,
  params: unknown[],
  actorId: string,
): Promise<string[]> {
  const result = await tx.query(
    `select id from artifacts where ${where} order by id asc`,
    params,
  );
  const readable: string[] = [];
  for (const row of result.rows) {
    const id = String((row as Record<string, unknown>).id);
    if ((await getArtifactForActor(tx, id, actorId)) !== null) readable.push(id);
  }
  return readable;
}

export async function listProductsForActor(
  tx: DbTransaction,
  input: { actorId: string; limit?: number | undefined; offset?: number | undefined },
): Promise<{ products: GalleryProduct[]; total: number; truncated: boolean }> {
  if (typeof input.actorId !== "string" || input.actorId.length === 0) {
    fail("Actor is invalid.");
  }
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    fail("Gallery limit is invalid.");
  }
  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    fail("Gallery cursor is invalid.");
  }
  const rows = (
    await tx.query(
      `select id, title from products order by title asc, id asc limit $1`,
      [MAX_PRODUCTS_EXAMINED + 1],
    )
  ).rows as Record<string, unknown>[];
  const truncated = rows.length > MAX_PRODUCTS_EXAMINED;
  const examined = truncated ? rows.slice(0, MAX_PRODUCTS_EXAMINED) : rows;
  const visible: GalleryProduct[] = [];
  for (const row of examined) {
    const productId = String(row.id);
    const readable = await readableArtifactIds(tx, "product_id = $1", [productId], input.actorId);
    if (readable.length === 0) continue;
    const versionRows = (
      await tx.query(`select id from product_versions where product_id = $1 order by version_no asc`, [productId])
    ).rows as Record<string, unknown>[];
    let visibleVersions = 0;
    for (const version of versionRows) {
      const artifacts = await readableArtifactIds(
        tx,
        "product_version_id = $1",
        [String(version.id)],
        input.actorId,
      );
      if (artifacts.length > 0) visibleVersions += 1;
    }
    visible.push({
      productId,
      title: String(row.title),
      versionCount: visibleVersions,
      artifactCount: readable.length,
    });
  }
  return { products: visible.slice(offset, offset + limit), total: visible.length, truncated };
}

export async function listProductVersionsForActor(
  tx: DbTransaction,
  input: { actorId: string; productId: string; limit?: number | undefined; offset?: number | undefined },
): Promise<{ versions: GalleryVersion[]; total: number; truncated: boolean }> {
  if (typeof input.actorId !== "string" || input.actorId.length === 0) {
    fail("Actor is invalid.");
  }
  if (typeof input.productId !== "string" || !UUID_PATTERN.test(input.productId)) {
    fail("Gallery product is invalid.");
  }
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    fail("Gallery limit is invalid.");
  }
  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    fail("Gallery cursor is invalid.");
  }
  const rows = (
    await tx.query(
      `select id, product_id, version_no from product_versions where product_id = $1
       order by version_no asc limit $2`,
      [input.productId, MAX_VERSIONS_EXAMINED + 1],
    )
  ).rows as Record<string, unknown>[];
  const truncated = rows.length > MAX_VERSIONS_EXAMINED;
  const examined = truncated ? rows.slice(0, MAX_VERSIONS_EXAMINED) : rows;
  const visible: GalleryVersion[] = [];
  for (const row of examined) {
    const versionId = String(row.id);
    const readable = await readableArtifactIds(
      tx,
      "product_version_id = $1",
      [versionId],
      input.actorId,
    );
    if (readable.length === 0) continue;
    visible.push({
      versionId,
      productId: String(row.product_id),
      versionNo: Number(row.version_no),
      artifactCount: readable.length,
    });
  }
  return { versions: visible.slice(offset, offset + limit), total: visible.length, truncated };
}
