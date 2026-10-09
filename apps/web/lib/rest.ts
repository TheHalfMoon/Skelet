import type { DbClient } from "../../../packages/db/src/db.ts";
import { searchAssets, resolveAsset } from "../../../packages/assets/src/registry.ts";
import { getArtifact } from "../../../packages/db/src/graph.ts";
import { exportReferencePack, parseSkeletUri } from "./reference-packs.ts";

/**
 * G08-03 REST API v1 read parity: the human/UI-readable surface over the
 * same contracts the MCP tools serve. Versioned by URL (/api/v1); breaking
 * changes require /api/v2 or a documented compatibility window. Every
 * endpoint requires a session-bound identity; unknown and denied objects
 * both answer 404 so existence is not an oracle.
 */

export interface RestResult {
  status: number;
  body: unknown;
}

function badRequest(message = "Request is invalid."): RestResult {
  return { status: 400, body: { error: message } };
}

function notFound(): RestResult {
  return { status: 404, body: { error: "Object was not found." } };
}

function opaque(): RestResult {
  return { status: 500, body: { error: "Request failed." } };
}

function agentAssetView(record: {
  artifactId: string;
  kind: string;
  title: string;
  license: string;
  rightsClassification: string;
  serving: string;
  servingReason: string;
  sourceKey: string;
  contentHash: string;
}): Record<string, unknown> {
  return {
    uri: `skelet://artifact/${record.artifactId}`,
    kind: record.kind,
    title: record.title,
    license: record.license,
    rights: record.rightsClassification,
    serving: record.serving,
    servingReason: record.servingReason,
    source: record.sourceKey,
    contentHash: record.contentHash,
  };
}

const REGISTRY_KINDS = ["icon", "logo", "font"] as const;

/** GET /api/v1/assets — unified search with facet filters. */
export async function searchAssetsRoute(
  db: DbClient,
  query: Record<string, string | string[] | undefined>,
): Promise<RestResult> {
  const rawQuery = query.query;
  if (typeof rawQuery !== "string" || rawQuery.trim().length === 0) {
    return badRequest();
  }
  const kinds = query.kinds === undefined ? undefined : String(query.kinds).split(",");
  if (kinds !== undefined) {
    if (
      kinds.length === 0 ||
      kinds.some((kind) => !(REGISTRY_KINDS as readonly string[]).includes(kind.trim()))
    ) {
      return badRequest();
    }
  }
  let limit = 20;
  if (query.limit !== undefined) {
    const parsed = Number(query.limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      return badRequest();
    }
    limit = parsed;
  }
  try {
    const search: {
      query: string;
      kinds?: ("icon" | "logo" | "font")[];
      limit: number;
    } = { query: rawQuery.trim(), limit };
    if (kinds !== undefined) {
      search.kinds = kinds.map((kind) => kind.trim()) as ("icon" | "logo" | "font")[];
    }
    const records = await searchAssets(db, search);
    return { status: 200, body: { assets: records.map(agentAssetView) } };
  } catch {
    return opaque();
  }
}

/** GET /api/v1/assets/[id] — resolve one record with policy. */
export async function getAssetRoute(db: DbClient, artifactId: string): Promise<RestResult> {
  try {
    return { status: 200, body: { asset: agentAssetView(await resolveAsset(db, artifactId)) } };
  } catch {
    return notFound();
  }
}

/** GET /api/v1/objects?uri= — retrieve by stable Skelet URI. */
export async function getObjectRoute(
  db: DbClient,
  uri: string | undefined,
  userId: string,
): Promise<RestResult> {
  if (typeof uri !== "string") {
    return badRequest();
  }
  let parsed;
  try {
    parsed = parseSkeletUri(uri);
  } catch {
    return badRequest();
  }
  try {
    if (parsed.type === "artifact") {
      const artifact = await getArtifact(db, parsed.id);
      if (artifact === null) {
        return notFound();
      }
      return {
        status: 200,
        body: {
          object: {
            uri,
            kind: artifact.kind,
            title: artifact.title,
            rights: artifact.rightsClassification,
          },
        },
      };
    }
    return { status: 200, body: { pack: await exportReferencePack(db, parsed.id, userId) } };
  } catch {
    return notFound();
  }
}
