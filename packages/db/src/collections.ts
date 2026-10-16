import type { DbClient, DbTransaction } from "./db.ts";
import { AuthError } from "./auth.ts";
import { getArtifactForActor } from "./artifact-access.ts";
import { getMembership, type WorkspaceRole } from "./workspaces.ts";

/**
 * G04-03 workspace-authorized collections: create/read/update/delete plus
 * the save-reference path over the G03-03 collections storage.
 *
 * Authority model: every operation first proves workspace membership
 * server-side; then visibility applies. Private collections belong to
 * their owner_subject alone (who must be a workspace member), including
 * visibility changes, which never leave the owner's hands;
 * workspace-visible collections are readable by all members and writable
 * by all members, while rename/delete additionally admit workspace admins
 * and owners. Unknown or malformed collection identifiers fail closed as
 * not-found; denied callers see one generic forbidden error. (Collection
 * identifiers are unguessable UUIDs, so the not-found/forbidden split
 * aids debugging without creating a practical enumeration oracle.)
 */

export type CollectionVisibility = "private" | "workspace";

export interface Collection {
  id: string;
  workspaceId: string;
  ownerSubject: string;
  title: string;
  visibility: CollectionVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionReference {
  collectionId: string;
  artifactId: string;
  savedAt: string;
  /** Dense zero-based board rank; contiguous per collection (AF-07-i). */
  position: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function toIsoTimestamp(raw: unknown): string {
  const value = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(value.getTime())) {
    throw new Error("Invalid collection timestamp");
  }
  return value.toISOString();
}

function toVisibility(value: unknown): CollectionVisibility {
  if (value !== "private" && value !== "workspace") {
    throw new Error("Invalid collection visibility in database");
  }
  return value;
}

function toCollection(row: Record<string, unknown>): Collection {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    ownerSubject: String(row.owner_subject),
    title: String(row.title),
    visibility: toVisibility(row.visibility),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

function requireRow(rows: Record<string, unknown>[]): Record<string, unknown> {
  const row = rows[0];
  if (!row) throw new Error("Database operation returned no row");
  return row;
}

function validateTitle(title: string): string {
  if (typeof title !== "string") {
    throw new AuthError("auth/invalid-collection", "Collection title is invalid.");
  }
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new AuthError("auth/invalid-collection", "Collection title is invalid.");
  }
  return trimmed;
}

function validateVisibility(visibility: string): CollectionVisibility {
  if (visibility !== "private" && visibility !== "workspace") {
    throw new AuthError("auth/invalid-collection", "Collection visibility is invalid.");
  }
  return visibility;
}

function forbidden(): AuthError {
  return new AuthError("auth/forbidden", "Access denied.");
}

function notFound(): AuthError {
  return new AuthError("auth/collection-not-found", "Collection was not found.");
}

async function loadCollection(
  tx: DbTransaction,
  collectionId: string,
): Promise<Collection | null> {
  if (!isUuid(collectionId)) return null;
  const result = await tx.query(
    `select id, workspace_id, owner_subject, title, visibility, created_at, updated_at
     from collections where id = $1`,
    [collectionId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toCollection(row);
}

/** Read gate: membership plus visibility. Returns the collection when allowed. */
async function authorizeRead(
  tx: DbTransaction,
  collectionId: string,
  callerId: string,
): Promise<Collection> {
  const collection = await loadCollection(tx, collectionId);
  if (collection === null) {
    throw notFound();
  }
  const role = await getMembership(tx, collection.workspaceId, callerId);
  if (role === null) {
    throw forbidden();
  }
  if (collection.visibility === "private" && collection.ownerSubject !== callerId) {
    throw forbidden();
  }
  return collection;
}

/** Write gate for items: private collections admit only their owner; workspace collections admit every member. */
async function authorizeItemWrite(
  tx: DbTransaction,
  collectionId: string,
  callerId: string,
): Promise<Collection> {
  const collection = await authorizeRead(tx, collectionId, callerId);
  if (collection.visibility === "private" && collection.ownerSubject !== callerId) {
    throw forbidden();
  }
  return collection;
}

/** Manage gate for rename/delete: owner_subject, or a workspace admin or owner. Visibility changes stay with the owner_subject alone. */
function authorizeManage(
  collection: Collection,
  callerId: string,
  callerRole: WorkspaceRole,
  visibilityChange: boolean,
): void {
  if (collection.ownerSubject === callerId) return;
  if (visibilityChange) {
    throw forbidden();
  }
  if (callerRole === "admin" || callerRole === "owner") return;
  throw forbidden();
}

/**
 * Create a collection owned by the caller. The caller must belong to the
 * workspace; the workspace binding is enforced by the 006 FK as well.
 */
export async function createCollection(
  client: DbClient,
  input: { workspaceId: string; title: string; visibility?: CollectionVisibility; actorId: string },
): Promise<Collection> {
  const title = validateTitle(input.title);
  const visibility = input.visibility === undefined ? "private" : validateVisibility(input.visibility);
  return client.transaction(async (tx) => {
    const role = await getMembership(tx, input.workspaceId, input.actorId);
    if (role === null) {
      throw forbidden();
    }
    try {
      const created = await tx.query(
        `insert into collections (workspace_id, owner_subject, title, visibility)
         values ($1, $2, $3, $4)
         returning id, workspace_id, owner_subject, title, visibility, created_at, updated_at`,
        [input.workspaceId, input.actorId, title, visibility],
      );
      return toCollection(requireRow(created.rows));
    } catch (error) {
      // A deleted workspace racing creation surfaces as its FK violation.
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code === "23503") {
        throw forbidden();
      }
      throw error;
    }
  });
}

export async function getCollection(
  tx: DbTransaction,
  collectionId: string,
  callerId: string,
): Promise<Collection> {
  return authorizeRead(tx, collectionId, callerId);
}

/** Rename (owner_subject, workspace admins, owners) and/or change visibility (owner_subject only). */
export async function updateCollection(
  client: DbClient,
  input: { collectionId: string; title?: string; visibility?: CollectionVisibility; actorId: string },
): Promise<Collection> {
  const title = input.title === undefined ? undefined : validateTitle(input.title);
  const visibility = input.visibility === undefined ? undefined : validateVisibility(input.visibility);
  if (title === undefined && visibility === undefined) {
    throw new AuthError("auth/invalid-collection", "Nothing to update.");
  }
  return client.transaction(async (tx) => {
    const collection = await loadCollection(tx, input.collectionId);
    if (collection === null) {
      throw notFound();
    }
    const role = await getMembership(tx, collection.workspaceId, input.actorId);
    if (role === null) {
      throw forbidden();
    }
    authorizeManage(collection, input.actorId, role, visibility !== undefined);
    const updated = await tx.query(
      `update collections set title = coalesce($2, title), visibility = coalesce($3, visibility)
       where id = $1
       returning id, workspace_id, owner_subject, title, visibility, created_at, updated_at`,
      [input.collectionId, title ?? null, visibility ?? null],
    );
    const row = updated.rows[0];
    if (row === undefined) {
      throw notFound();
    }
    return toCollection(row);
  });
}

/** Delete a collection and its items (cascade); same authority as update. */
export async function deleteCollection(
  client: DbClient,
  input: { collectionId: string; actorId: string },
): Promise<void> {
  await client.transaction(async (tx) => {
    const collection = await loadCollection(tx, input.collectionId);
    if (collection === null) {
      throw notFound();
    }
    const role = await getMembership(tx, collection.workspaceId, input.actorId);
    if (role === null) {
      throw forbidden();
    }
    authorizeManage(collection, input.actorId, role, false);
    await tx.query("delete from collections where id = $1", [input.collectionId]);
  });
}

/**
 * Save a canonical artifact reference into a collection. Idempotent:
 * re-saving returns the existing reference. Unknown, malformed, or
 * unreadable artifacts fail closed without revealing collection state.
 *
 * AF-SEC-00: the saver must already be authorized to read the artifact.
 * This closes the laundering path where a member of workspace A saves a
 * private artifact from workspace B by guessed ID and then re-exports it.
 */
export async function saveReference(
  client: DbClient,
  input: { collectionId: string; artifactId: string; actorId: string },
): Promise<CollectionReference> {
  if (!isUuid(input.artifactId)) {
    throw new AuthError("auth/artifact-not-found", "Artifact was not found.");
  }
  return client.transaction(async (tx) => {
    const collection = await authorizeItemWrite(tx, input.collectionId, input.actorId);
    const readable = await getArtifactForActor(tx, input.artifactId, input.actorId);
    if (readable === null) {
      throw new AuthError("auth/artifact-not-found", "Artifact was not found.");
    }
    await lockCollectionItems(tx, collection.id);
    // ON CONFLICT keeps the transaction healthy: a duplicate raises no
    // error, so the follow-up read runs on a live transaction on both
    // PostgreSQL and PGlite (a caught unique violation would abort it).
    // Appends take max(position) + 1 under the parent lock, so concurrent
    // savers converge instead of sharing a rank.
    const saved = await tx.query(
      `insert into collection_items (collection_id, artifact_id, position)
       values ($1, $2, (select coalesce(max(position) + 1, 0) from collection_items where collection_id = $1))
       on conflict (collection_id, artifact_id) do nothing
       returning collection_id, artifact_id, saved_at, position`,
      [collection.id, input.artifactId],
    );
    const inserted = saved.rows[0];
    if (inserted !== undefined) {
      return toReference(inserted);
    }
    const existing = await tx.query(
      `select collection_id, artifact_id, saved_at, position from collection_items
       where collection_id = $1 and artifact_id = $2`,
      [collection.id, input.artifactId],
    );
    return toReference(requireRow(existing.rows));
  });
}

/** Remove a saved reference; removing an absent reference succeeds. Gaps close so ranks stay dense. */
export async function removeReference(
  client: DbClient,
  input: { collectionId: string; artifactId: string; actorId: string },
): Promise<void> {
  await client.transaction(async (tx) => {
    const collection = await authorizeItemWrite(tx, input.collectionId, input.actorId);
    await lockCollectionItems(tx, collection.id);
    await tx.query(
      `delete from collection_items where collection_id = $1 and artifact_id = $2`,
      [collection.id, input.artifactId],
    );
    await renumberPositions(tx, collection.id);
  });
}

/**
 * Move a saved board item to an explicit zero-based rank. The rank must
 * exist (0..count-1): out-of-range ranks fail closed instead of clamping,
 * so callers observe the board they actually changed. Siblings shift in
 * one transaction; ranks stay dense 0..n-1 afterwards. Moving an absent
 * item fails closed as not-found, never as a silent no-op.
 */
export async function moveReference(
  client: DbClient,
  input: { collectionId: string; artifactId: string; actorId: string; toPosition: number },
): Promise<CollectionReference[]> {
  if (!Number.isInteger(input.toPosition) || input.toPosition < 0) {
    throw new AuthError("auth/invalid-collection", "Board position is invalid.");
  }
  return client.transaction(async (tx) => {
    const collection = await authorizeItemWrite(tx, input.collectionId, input.actorId);
    await lockCollectionItems(tx, collection.id);
    const ordered = await tx.query(
      `select artifact_id from collection_items
       where collection_id = $1 order by position, saved_at, artifact_id`,
      [collection.id],
    );
    const ids = ordered.rows.map((row) => String((row as Record<string, unknown>).artifact_id));
    const from = ids.indexOf(input.artifactId);
    if (from < 0) {
      throw notFound();
    }
    if (input.toPosition >= ids.length) {
      throw new AuthError("auth/invalid-collection", "Board position is invalid.");
    }
    const [moved] = ids.splice(from, 1);
    ids.splice(input.toPosition, 0, moved as string);
    let position = 0;
    for (const artifactId of ids) {
      await tx.query(
        `update collection_items set position = $3
         where collection_id = $1 and artifact_id = $2`,
        [collection.id, artifactId, position],
      );
      position += 1;
    }
    const result = await tx.query(
      `select collection_id, artifact_id, saved_at, position from collection_items
       where collection_id = $1 order by position, saved_at, artifact_id`,
      [collection.id],
    );
    return result.rows.map(toReference);
  });
}

function toReference(row: Record<string, unknown>): CollectionReference {
  const position = Number(row.position);
  if (!Number.isInteger(position) || position < 0) {
    throw new Error("Invalid collection item position in database");
  }
  return {
    collectionId: String(row.collection_id),
    artifactId: String(row.artifact_id),
    savedAt: toIsoTimestamp(row.saved_at),
    position,
  };
}

/**
 * Serialize writers of one collection on its parent row so concurrent
 * appends converge on distinct positions instead of racing max(position).
 * Call inside the writer transaction after authorization.
 */
async function lockCollectionItems(tx: DbTransaction, collectionId: string): Promise<void> {
  await tx.query("select id from collections where id = $1 for update", [collectionId]);
}

/** Renumber one collection's items to dense 0..n-1 in board order. */
async function renumberPositions(tx: DbTransaction, collectionId: string): Promise<void> {
  const ordered = await tx.query(
    `select artifact_id from collection_items
     where collection_id = $1 order by position, saved_at, artifact_id for update`,
    [collectionId],
  );
  let position = 0;
  for (const row of ordered.rows) {
    await tx.query(
      `update collection_items set position = $3
       where collection_id = $1 and artifact_id = $2`,
      [collectionId, String((row as Record<string, unknown>).artifact_id), position],
    );
    position += 1;
  }
}

/** List saved references in board order; read authority applies. */
export async function listReferences(
  tx: DbTransaction,
  collectionId: string,
  callerId: string,
): Promise<CollectionReference[]> {
  const collection = await authorizeRead(tx, collectionId, callerId);
  const result = await tx.query(
    `select collection_id, artifact_id, saved_at, position from collection_items
     where collection_id = $1 order by position, saved_at, artifact_id`,
    [collection.id],
  );
  return result.rows.map(toReference);
}

/** One ownership transfer in the append-only handoff ledger. */
export interface CollectionHandoff {
  id: string;
  collectionId: string;
  fromSubject: string;
  toSubject: string;
  actorId: string;
  createdAt: string;
}

function toHandoff(row: Record<string, unknown>): CollectionHandoff {
  return {
    id: String(row.id),
    collectionId: String(row.collection_id),
    fromSubject: String(row.from_subject),
    toSubject: String(row.to_subject),
    actorId: String(row.actor_id),
    createdAt: toIsoTimestamp(row.created_at),
  };
}

/**
 * Hand a board to another workspace member. Only the current owner hands
 * off (admins cannot seize ownership, matching the owner-only visibility
 * rule); the recipient must already belong to the workspace, so boards
 * never leak to outsiders through transfer. The transfer and its ledger
 * row share one transaction; visibility is unchanged, so a private board
 * stays visible to its new owner alone.
 */
export async function handOffCollection(
  client: DbClient,
  input: { collectionId: string; actorId: string; toSubjectId: string },
): Promise<{ collection: Collection; handoff: CollectionHandoff }> {
  if (typeof input.toSubjectId !== "string" || !isUuid(input.toSubjectId)) {
    throw new AuthError("auth/invalid-collection", "Handoff recipient is invalid.");
  }
  return client.transaction(async (tx) => {
    const collection = await loadCollection(tx, input.collectionId);
    if (collection === null) {
      throw notFound();
    }
    const role = await getMembership(tx, collection.workspaceId, input.actorId);
    if (role === null) {
      throw forbidden();
    }
    if (collection.ownerSubject !== input.actorId) {
      throw forbidden();
    }
    if (input.toSubjectId === collection.ownerSubject) {
      throw new AuthError("auth/invalid-collection", "Handoff recipient is invalid.");
    }
    const targetRole = await getMembership(tx, collection.workspaceId, input.toSubjectId);
    if (targetRole === null) {
      throw forbidden();
    }
    await lockCollectionItems(tx, collection.id);
    const updated = await tx.query(
      `update collections set owner_subject = $2, updated_at = now()
       where id = $1
       returning id, workspace_id, owner_subject, title, visibility, created_at, updated_at`,
      [collection.id, input.toSubjectId],
    );
    const next = toCollection(requireRow(updated.rows));
    const logged = await tx.query(
      `insert into collection_handoffs (collection_id, from_subject, to_subject, actor_id)
       values ($1, $2, $3, $4)
       returning id, collection_id, from_subject, to_subject, actor_id, created_at`,
      [collection.id, collection.ownerSubject, input.toSubjectId, input.actorId],
    );
    return { collection: next, handoff: toHandoff(requireRow(logged.rows)) };
  });
}

/** Read the provenance chain of a board; same read gate as the board itself. */
export async function listHandoffs(
  tx: DbTransaction,
  collectionId: string,
  callerId: string,
): Promise<CollectionHandoff[]> {
  const collection = await authorizeRead(tx, collectionId, callerId);
  const result = await tx.query(
    `select id, collection_id, from_subject, to_subject, actor_id, created_at
     from collection_handoffs where collection_id = $1 order by created_at, id`,
    [collection.id],
  );
  return result.rows.map(toHandoff);
}

/** Per-item validation outcome for handoff inspection. */
export interface CollectionItemStatus {
  uri: string;
  artifactId: string;
  status: "ok" | "denied" | "missing";
  kind?: string;
  title?: string;
  rights?: string;
}

/**
 * Validate every board item for handoff: readable items resolve with
 * kind/title/rights (the same metadata a pack export already reveals),
 * while denied and missing items report their status without leaking
 * anything beyond the already-listed identifier. Malformed or
 * unauthorized boards fail closed before any item is touched.
 */
export async function validateCollectionItems(
  tx: DbTransaction,
  collectionId: string,
  callerId: string,
): Promise<{
  collectionId: string;
  items: CollectionItemStatus[];
  summary: { ok: number; denied: number; missing: number };
}> {
  const collection = await authorizeRead(tx, collectionId, callerId);
  const refs = await listReferences(tx, collection.id, callerId);
  const items: CollectionItemStatus[] = [];
  for (const ref of refs) {
    const artifact = await getArtifactForActor(tx, ref.artifactId, callerId);
    if (artifact !== null) {
      const status: CollectionItemStatus = {
        uri: `skilit://artifact/${ref.artifactId}`,
        artifactId: ref.artifactId,
        status: "ok",
      };
      status.kind = artifact.kind;
      status.title = artifact.title;
      status.rights = artifact.rightsClassification;
      items.push(status);
      continue;
    }
    const exists = await tx.query("select id from artifacts where id = $1", [ref.artifactId]);
    items.push({
      uri: `skilit://artifact/${ref.artifactId}`,
      artifactId: ref.artifactId,
      status: exists.rows[0] === undefined ? "missing" : "denied",
    });
  }
  return {
    collectionId: collection.id,
    items,
    summary: {
      ok: items.filter((entry) => entry.status === "ok").length,
      denied: items.filter((entry) => entry.status === "denied").length,
      missing: items.filter((entry) => entry.status === "missing").length,
    },
  };
}

/**
 * List collections of a workspace visible to the caller: workspace-visible
 * collections plus the caller's own private ones. Membership required.
 */
export async function listCollections(
  tx: DbTransaction,
  workspaceId: string,
  callerId: string,
): Promise<Collection[]> {
  const role = await getMembership(tx, workspaceId, callerId);
  if (role === null) {
    throw forbidden();
  }
  const result = await tx.query(
    `select id, workspace_id, owner_subject, title, visibility, created_at, updated_at
     from collections where workspace_id = $1
       and (visibility = 'workspace' or owner_subject = $2)
     order by created_at, id`,
    [workspaceId, callerId],
  );
  return result.rows.map(toCollection);
}
