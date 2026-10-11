import type { DbClient, DbTransaction } from "../../../packages/db/src/db.ts";
import { getArtifactForActor } from "../../../packages/db/src/artifact-access.ts";
import {
  createCollection,
  getCollection,
  listReferences,
  saveReference,
} from "../../../packages/db/src/collections.ts";

/**
 * G08-02 agent write layer: reference packs over workspace collections.
 * A pack is a collection plus a versioned, self-contained export whose
 * every entry carries a stable Skelet URI, so a later agent recovers the
 * source evidence without the original session.
 *
 * Identity model: actorId is always server-resolved (bound from the
 * caller's validated session by the MCP route). Membership and
 * visibility are enforced on that identity by the collections layer.
 */

export const REFERENCE_PACK_SCHEMA = "skelet/reference-pack/1";

export interface PackReference {
  uri: string;
  kind: string;
  title: string;
  rights: string;
}

export interface ReferencePackExport {
  schema: string;
  uri: string;
  title: string;
  visibility: string;
  workspaceId: string;
  itemCount: number;
  exportedAt: string;
  items: PackReference[];
}

export class PackError extends Error {
  readonly code: "packs/invalid" | "packs/not-found" | "packs/forbidden";
  constructor(code: PackError["code"], message: string) {
    super(message);
    this.name = "PackError";
    this.code = code;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSkeletUri(uri: string): { type: "artifact" | "collection"; id: string } {
  if (typeof uri !== "string") {
    throw new PackError("packs/invalid", "Skelet URI is invalid.");
  }
  const match = /^skelet:\/\/(artifact|collection)\/([0-9a-f-]{36})$/i.exec(uri.trim());
  if (match === null || !UUID_PATTERN.test(match[2] ?? "")) {
    throw new PackError("packs/invalid", "Skelet URI is invalid.");
  }
  const type = (match[1] ?? "").toLowerCase();
  if (type !== "artifact" && type !== "collection") {
    throw new PackError("packs/invalid", "Skelet URI is invalid.");
  }
  return { type, id: (match[2] ?? "").toLowerCase() };
}

/** Create a pack (workspace collection) owned by the calling identity. */
export async function createReferencePack(
  db: DbClient,
  input: {
    workspaceId: string;
    title: string;
    actorId: string;
    visibility?: "private" | "workspace";
    artifactIds?: string[];
  },
): Promise<{ collectionId: string; uri: string }> {
  if (typeof input.title !== "string" || input.title.trim().length === 0 || input.title.length > 256) {
    throw new PackError("packs/invalid", "Reference pack title is invalid.");
  }
  const artifactIds = input.artifactIds ?? [];
  if (!Array.isArray(artifactIds) || artifactIds.length > 200) {
    throw new PackError("packs/invalid", "Reference pack items are invalid.");
  }
  // Validate every item before creating anything: no partial packs.
  for (const artifactId of artifactIds) {
    if (typeof artifactId !== "string" || !UUID_PATTERN.test(artifactId)) {
      throw new PackError("packs/invalid", "Reference pack item is invalid.");
    }
  }
  const collection = await createCollection(db, {
    workspaceId: input.workspaceId,
    title: input.title,
    visibility: input.visibility ?? "workspace",
    actorId: input.actorId,
  });
  for (const artifactId of artifactIds) {
    await saveReference(db, {
      collectionId: collection.id,
      artifactId,
      actorId: input.actorId,
    });
  }
  return { collectionId: collection.id, uri: `skelet://collection/${collection.id}` };
}

/** Export a pack: read-gated collection plus resolved evidence entries.
 *
 * AF-SEC-00: collection authorization runs first via getCollection (no
 * header oracle), then every item resolves through the actor gate.
 * Denied or missing items are skipped so a stale or retracted reference
 * can never leak metadata through an otherwise authorized pack export.
 */
export async function exportReferencePack(
  tx: DbTransaction,
  collectionId: string,
  callerId: string,
): Promise<ReferencePackExport> {
  const collection = await getCollection(tx, collectionId, callerId);
  const refs = await listReferences(tx, collection.id, callerId);
  const items: PackReference[] = [];
  for (const ref of refs) {
    const artifact = await getArtifactForActor(tx, ref.artifactId, callerId);
    if (artifact === null) continue;
    items.push({
      uri: `skelet://artifact/${artifact.id}`,
      kind: artifact.kind,
      title: artifact.title,
      rights: artifact.rightsClassification,
    });
  }
  return {
    schema: REFERENCE_PACK_SCHEMA,
    uri: `skelet://collection/${collection.id}`,
    title: collection.title,
    visibility: collection.visibility,
    workspaceId: collection.workspaceId,
    itemCount: items.length,
    exportedAt: new Date().toISOString(),
    items,
  };
}
