import type { DbClient } from "../../../packages/db/src/db.ts";
import { AuthError } from "../../../packages/db/src/auth.ts";
import {
  createCollection,
  deleteCollection,
  getCollection,
  handOffCollection,
  listCollections,
  listHandoffs,
  listReferences,
  moveReference,
  removeReference,
  saveReference,
  updateCollection,
  validateCollectionItems,
  type Collection,
  type CollectionReference,
} from "../../../packages/db/src/collections.ts";
import {
  AgentContractError,
  newRequestId,
  observedProvenance,
  successEnvelope,
} from "./agent-contract.ts";
import type { AgentEnvelope } from "./agent-contract.ts";

/**
 * AF-08-i board REST layer over the collections domain (reference
 * boards): list/create/get/update/delete boards, list/save/remove/move
 * items. Canonical skelet.agent.v1 envelopes; HTTP statuses derive from
 * the one error catalog in agent-contract.ts.
 *
 * Authority: workspaceId is a client-supplied locator; membership
 * resolved from the server-bound actorId is the authority. Unknown,
 * denied, malformed, and cross-tenant boards answer alike
 * (FORBIDDEN_OR_NOT_FOUND): no existence oracle. Validation failures
 * are INVALID_INPUT with bounded safe messages.
 */

export interface RestResult {
  status: number;
  body: AgentEnvelope;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATE_FIELDS = new Set(["workspaceId", "title", "visibility"]);
const UPDATE_FIELDS = new Set(["title", "visibility"]);
const SAVE_FIELDS = new Set(["workspaceId", "artifactId"]);
const MOVE_FIELDS = new Set(["workspaceId", "artifactId", "toPosition"]);
const HANDOFF_FIELDS = new Set(["workspaceId", "toSubjectId"]);

function invalidInput(requestId: string, message: string): RestResult {
  const err = new AgentContractError("INVALID_INPUT", { message, requestId });
  return { status: err.httpStatus, body: err.toFailureEnvelope() };
}

function opaque(requestId: string): RestResult {
  const err = new AgentContractError("INTERNAL_OPAQUE", { requestId });
  return { status: err.httpStatus, body: err.toFailureEnvelope() };
}

function notFound(requestId: string): RestResult {
  const err = new AgentContractError("FORBIDDEN_OR_NOT_FOUND", { requestId });
  return { status: err.httpStatus, body: err.toFailureEnvelope() };
}

function toFailure(error: unknown, requestId: string): RestResult {
  if (error instanceof AgentContractError) {
    const withId = new AgentContractError(error.code, {
      message: error.code === "INVALID_INPUT" ? error.safeMessage : undefined,
      requestId,
    });
    return { status: withId.httpStatus, body: withId.toFailureEnvelope() };
  }
  if (error instanceof AuthError) {
    if (error.code === "auth/invalid-collection") {
      return invalidInput(requestId, "Board request is invalid.");
    }
    return notFound(requestId);
  }
  if (error instanceof Error && error.name === "AuthError") return notFound(requestId);
  return opaque(requestId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boardUri(id: string): string {
  return `skelet://collection/${id}`;
}

function toBoardView(collection: Collection): Record<string, unknown> {
  return {
    uri: boardUri(collection.id),
    id: collection.id,
    workspaceId: collection.workspaceId,
    title: collection.title,
    visibility: collection.visibility,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  };
}

function toItemView(reference: CollectionReference): Record<string, unknown> {
  return {
    uri: `skelet://artifact/${reference.artifactId}`,
    artifactId: reference.artifactId,
    position: reference.position,
    savedAt: reference.savedAt,
  };
}

function checkActor(actorId: string, requestId: string): RestResult | null {
  if (!UUID_PATTERN.test(actorId)) return notFound(requestId);
  return null;
}

function checkWorkspace(workspaceId: unknown, requestId: string): RestResult | null {
  if (typeof workspaceId !== "string" || !UUID_PATTERN.test(workspaceId)) {
    return notFound(requestId);
  }
  return null;
}

function checkBoardId(boardId: unknown, requestId: string): RestResult | null {
  if (typeof boardId !== "string" || !UUID_PATTERN.test(boardId)) {
    return notFound(requestId);
  }
  return null;
}

function checkArtifactId(artifactId: unknown, requestId: string): RestResult | null {
  if (typeof artifactId !== "string" || !UUID_PATTERN.test(artifactId)) {
    return notFound(requestId);
  }
  return null;
}

function checkTitle(title: unknown, requestId: string): RestResult | null {
  if (typeof title !== "string" || title.trim().length === 0 || title.length > 200) {
    return invalidInput(requestId, "Board title is invalid.");
  }
  return null;
}

/** GET list: workspace-visible boards plus the caller's own private ones. */
export async function listBoardsRoute(
  db: DbClient,
  query: { workspaceId?: unknown },
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const workspaceFailed = checkWorkspace(query.workspaceId, requestId);
  if (workspaceFailed !== null) return workspaceFailed;
  try {
    const boards = await listCollections(db, query.workspaceId as string, actorId);
    return {
      status: 200,
      body: successEnvelope(requestId, { boards: boards.map(toBoardView) }),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

/** POST create: 201 with the board view. */
export async function createBoardRoute(
  db: DbClient,
  body: unknown,
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  if (!isRecord(body)) {
    return invalidInput(requestId, "Board request is invalid.");
  }
  for (const key of Object.keys(body)) {
    if (!CREATE_FIELDS.has(key)) {
      return invalidInput(requestId, "Board request is invalid.");
    }
  }
  const workspaceFailed = checkWorkspace(body.workspaceId, requestId);
  if (workspaceFailed !== null) return workspaceFailed;
  const titleFailed = checkTitle(body.title, requestId);
  if (titleFailed !== null) return titleFailed;
  let visibility: "private" | "workspace" | undefined;
  if (body.visibility !== undefined) {
    if (body.visibility !== "private" && body.visibility !== "workspace") {
      return invalidInput(requestId, "Board visibility is invalid.");
    }
    visibility = body.visibility;
  }
  try {
    const board = await createCollection(db, {
      workspaceId: body.workspaceId as string,
      title: (body.title as string).trim(),
      ...(visibility === undefined ? {} : { visibility }),
      actorId,
    });
    return {
      status: 201,
      body: successEnvelope(
        requestId,
        { board: toBoardView(board) },
        { provenance: observedProvenance(boardUri(board.id)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

/** GET one board with its items in board order. */
export async function getBoardRoute(
  db: DbClient,
  query: { boardId?: unknown },
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const boardFailed = checkBoardId(query.boardId, requestId);
  if (boardFailed !== null) return boardFailed;
  try {
    const board = await getCollection(db, query.boardId as string, actorId);
    const items = await listReferences(db, query.boardId as string, actorId);
    return {
      status: 200,
      body: successEnvelope(
        requestId,
        { board: toBoardView(board), items: items.map(toItemView) },
        { provenance: observedProvenance(boardUri(board.id)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

/** PATCH one board: rename and/or visibility (owner-only visibility). */
export async function updateBoardRoute(
  db: DbClient,
  boardId: unknown,
  body: unknown,
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const boardFailed = checkBoardId(boardId, requestId);
  if (boardFailed !== null) return boardFailed;
  if (!isRecord(body)) {
    return invalidInput(requestId, "Board request is invalid.");
  }
  for (const key of Object.keys(body)) {
    if (!UPDATE_FIELDS.has(key)) {
      return invalidInput(requestId, "Board request is invalid.");
    }
  }
  if (body.title === undefined && body.visibility === undefined) {
    return invalidInput(requestId, "Board request is invalid.");
  }
  if (body.title !== undefined) {
    const titleFailed = checkTitle(body.title, requestId);
    if (titleFailed !== null) return titleFailed;
  }
  if (body.visibility !== undefined && body.visibility !== "private" && body.visibility !== "workspace") {
    return invalidInput(requestId, "Board visibility is invalid.");
  }
  try {
    const board = await updateCollection(db, {
      collectionId: boardId as string,
      ...(body.title === undefined ? {} : { title: (body.title as string).trim() }),
      ...(body.visibility === undefined
        ? {}
        : { visibility: body.visibility as "private" | "workspace" }),
      actorId,
    });
    return {
      status: 200,
      body: successEnvelope(
        requestId,
        { board: toBoardView(board) },
        { provenance: observedProvenance(boardUri(board.id)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

/** DELETE one board and its items (cascade). Idempotent: missing answers 404. */
export async function deleteBoardRoute(
  db: DbClient,
  boardId: unknown,
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const boardFailed = checkBoardId(boardId, requestId);
  if (boardFailed !== null) return boardFailed;
  try {
    await deleteCollection(db, { collectionId: boardId as string, actorId });
    return { status: 200, body: successEnvelope(requestId, { deleted: true }) };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

/** POST save an item: idempotent append, original rank kept on replay. */
export async function saveBoardItemRoute(
  db: DbClient,
  boardId: unknown,
  body: unknown,
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const boardFailed = checkBoardId(boardId, requestId);
  if (boardFailed !== null) return boardFailed;
  if (!isRecord(body)) {
    return invalidInput(requestId, "Board request is invalid.");
  }
  for (const key of Object.keys(body)) {
    if (!SAVE_FIELDS.has(key)) {
      return invalidInput(requestId, "Board request is invalid.");
    }
  }
  const workspaceFailed = checkWorkspace(body.workspaceId, requestId);
  if (workspaceFailed !== null) return workspaceFailed;
  const artifactFailed = checkArtifactId(body.artifactId, requestId);
  if (artifactFailed !== null) return artifactFailed;
  try {
    // Workspace locator must agree with the board's workspace: no aliasing.
    const board = await getCollection(db, boardId as string, actorId);
    if (board.workspaceId !== body.workspaceId) {
      return notFound(requestId);
    }
    const item = await saveReference(db, {
      collectionId: board.id,
      artifactId: body.artifactId as string,
      actorId,
    });
    const items = await listReferences(db, board.id, actorId);
    return {
      status: 200,
      body: successEnvelope(
        requestId,
        { item: toItemView(item), items: items.map(toItemView) },
        { provenance: observedProvenance(boardUri(board.id)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

/** DELETE one item: deterministic, repeat removal succeeds with gaps closed. */
export async function removeBoardItemRoute(
  db: DbClient,
  query: { boardId?: unknown; artifactId?: unknown },
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const boardFailed = checkBoardId(query.boardId, requestId);
  if (boardFailed !== null) return boardFailed;
  const artifactFailed = checkArtifactId(query.artifactId, requestId);
  if (artifactFailed !== null) return artifactFailed;
  try {
    const board = await getCollection(db, query.boardId as string, actorId);
    await removeReference(db, {
      collectionId: board.id,
      artifactId: query.artifactId as string,
      actorId,
    });
    const items = await listReferences(db, board.id, actorId);
    return {
      status: 200,
      body: successEnvelope(
        requestId,
        { items: items.map(toItemView), removed: true },
        { provenance: observedProvenance(boardUri(board.id)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

/** POST move one item to an explicit rank; out-of-range ranks fail closed. */
export async function moveBoardItemRoute(
  db: DbClient,
  boardId: unknown,
  body: unknown,
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const boardFailed = checkBoardId(boardId, requestId);
  if (boardFailed !== null) return boardFailed;
  if (!isRecord(body)) {
    return invalidInput(requestId, "Board request is invalid.");
  }
  for (const key of Object.keys(body)) {
    if (!MOVE_FIELDS.has(key)) {
      return invalidInput(requestId, "Board request is invalid.");
    }
  }
  const workspaceFailed = checkWorkspace(body.workspaceId, requestId);
  if (workspaceFailed !== null) return workspaceFailed;
  const artifactFailed = checkArtifactId(body.artifactId, requestId);
  if (artifactFailed !== null) return artifactFailed;
  if (typeof body.toPosition !== "number" || !Number.isInteger(body.toPosition) || body.toPosition < 0) {
    return invalidInput(requestId, "Board position is invalid.");
  }
  try {
    const board = await getCollection(db, boardId as string, actorId);
    if (board.workspaceId !== body.workspaceId) {
      return notFound(requestId);
    }
    const items = await moveReference(db, {
      collectionId: board.id,
      artifactId: body.artifactId as string,
      actorId,
      toPosition: body.toPosition as number,
    });
    return {
      status: 200,
      body: successEnvelope(
        requestId,
        { items: items.map(toItemView) },
        { provenance: observedProvenance(boardUri(board.id)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

export type { AgentEnvelope };

function toHandoffView(handoff: {
  id: string;
  collectionId: string;
  fromSubject: string;
  toSubject: string;
  actorId: string;
  createdAt: string;
}): Record<string, unknown> {
  return {
    id: handoff.id,
    boardUri: boardUri(handoff.collectionId),
    fromSubject: handoff.fromSubject,
    toSubject: handoff.toSubject,
    actorId: handoff.actorId,
    createdAt: handoff.createdAt,
  };
}

/** POST hand off board ownership to a workspace member with ledger proof. */
export async function handOffBoardRoute(
  db: DbClient,
  boardId: unknown,
  body: unknown,
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const boardFailed = checkBoardId(boardId, requestId);
  if (boardFailed !== null) return boardFailed;
  if (!isRecord(body)) {
    return invalidInput(requestId, "Board request is invalid.");
  }
  for (const key of Object.keys(body)) {
    if (!HANDOFF_FIELDS.has(key)) {
      return invalidInput(requestId, "Board request is invalid.");
    }
  }
  const workspaceFailed = checkWorkspace(body.workspaceId, requestId);
  if (workspaceFailed !== null) return workspaceFailed;
  if (typeof body.toSubjectId !== "string" || !UUID_PATTERN.test(body.toSubjectId)) {
    return notFound(requestId);
  }
  try {
    const board = await getCollection(db, boardId as string, actorId);
    if (board.workspaceId !== body.workspaceId) {
      return notFound(requestId);
    }
    const { collection, handoff } = await handOffCollection(db, {
      collectionId: board.id,
      actorId,
      toSubjectId: body.toSubjectId as string,
    });
    return {
      status: 200,
      body: successEnvelope(
        requestId,
        { board: toBoardView(collection), handoff: toHandoffView(handoff) },
        { provenance: observedProvenance(boardUri(collection.id)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

/** GET the provenance chain of a board. */
export async function listBoardHandoffsRoute(
  db: DbClient,
  query: { boardId?: unknown },
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const boardFailed = checkBoardId(query.boardId, requestId);
  if (boardFailed !== null) return boardFailed;
  try {
    const board = await getCollection(db, query.boardId as string, actorId);
    const handoffs = await listHandoffs(db, query.boardId as string, actorId);
    return {
      status: 200,
      body: successEnvelope(
        requestId,
        { board: toBoardView(board), handoffs: handoffs.map(toHandoffView) },
        { provenance: observedProvenance(boardUri(board.id)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

/** GET per-item validation for handoff inspection. */
export async function validateBoardItemsRoute(
  db: DbClient,
  query: { boardId?: unknown },
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const boardFailed = checkBoardId(query.boardId, requestId);
  if (boardFailed !== null) return boardFailed;
  try {
    const board = await getCollection(db, query.boardId as string, actorId);
    const validation = await validateCollectionItems(db, query.boardId as string, actorId);
    return {
      status: 200,
      body: successEnvelope(
        requestId,
        {
          board: toBoardView(board),
          items: validation.items.map((entry) => ({
            uri: entry.uri,
            artifactId: entry.artifactId,
            status: entry.status,
            ...(entry.kind === undefined ? {} : { kind: entry.kind }),
            ...(entry.title === undefined ? {} : { title: entry.title }),
            ...(entry.rights === undefined ? {} : { rights: entry.rights }),
          })),
          summary: validation.summary,
        },
        { provenance: observedProvenance(boardUri(board.id)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}
