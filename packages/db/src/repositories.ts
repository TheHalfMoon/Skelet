import type { DbClient } from "./db.ts";

export interface Source {
  id: string;
  key: string;
  kind: string;
  displayName: string | null;
  createdAt: string;
}

export interface NewSource {
  key: string;
  kind: string;
  displayName?: string;
}

export interface Product {
  id: string;
  sourceId: string;
  externalId: string | null;
  title: string;
  createdAt: string;
}

export interface NewProduct {
  sourceId: string;
  externalId?: string;
  title: string;
}

export interface ProductVersion {
  id: string;
  productId: string;
  versionNo: number;
  capturedAt: string;
}

export interface NewProductVersion {
  productId: string;
  versionNo: number;
}

function requireRow(rows: Record<string, unknown>[]): Record<string, unknown> {
  const row = rows[0];
  if (!row) throw new Error("Database operation returned no row");
  return row;
}

function toSource(row: Record<string, unknown>): Source {
  return {
    id: String(row.id),
    key: String(row.key),
    kind: String(row.kind),
    displayName:
      row.display_name === null ? null : String(row.display_name),
    createdAt: String(row.created_at),
  };
}

export async function createSource(
  client: DbClient,
  input: NewSource,
): Promise<Source> {
  const result = await client.query(
    `insert into sources (key, kind, display_name)
     values ($1, $2, $3) returning id, key, kind, display_name, created_at`,
    [input.key, input.kind, input.displayName ?? null],
  );
  return toSource(requireRow(result.rows));
}

export async function getSource(
  client: DbClient,
  id: string,
): Promise<Source> {
  const result = await client.query(
    "select id, key, kind, display_name, created_at from sources where id = $1",
    [id],
  );
  if (result.rows.length === 0) {
    throw new Error(`source not found: ${id}`);
  }
  return toSource(requireRow(result.rows));
}

function toProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    externalId:
      row.external_id === null ? null : String(row.external_id),
    title: String(row.title),
    createdAt: String(row.created_at),
  };
}

export async function createProduct(
  client: DbClient,
  input: NewProduct,
): Promise<Product> {
  const result = await client.query(
    `insert into products (source_id, external_id, title)
     values ($1, $2, $3)
     returning id, source_id, external_id, title, created_at`,
    [input.sourceId, input.externalId ?? null, input.title],
  );
  return toProduct(requireRow(result.rows));
}

export async function listProducts(
  client: DbClient,
  sourceId: string,
): Promise<Product[]> {
  const result = await client.query(
    `select id, source_id, external_id, title, created_at from products
     where source_id = $1 order by created_at, id`,
    [sourceId],
  );
  return result.rows.map(toProduct);
}

function toProductVersion(row: Record<string, unknown>): ProductVersion {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    versionNo: Number(row.version_no),
    capturedAt: String(row.captured_at),
  };
}

export async function createProductVersion(
  client: DbClient,
  input: NewProductVersion,
): Promise<ProductVersion> {
  const result = await client.query(
    `insert into product_versions (product_id, version_no)
     values ($1, $2)
     returning id, product_id, version_no, captured_at`,
    [input.productId, input.versionNo],
  );
  return toProductVersion(requireRow(result.rows));
}

export async function listProductVersions(
  client: DbClient,
  productId: string,
): Promise<ProductVersion[]> {
  const result = await client.query(
    `select id, product_id, version_no, captured_at from product_versions
     where product_id = $1 order by version_no`,
    [productId],
  );
  return result.rows.map(toProductVersion);
}
