import type { DbTransaction } from "./db.ts";
import { getArtifactForActor } from "./artifact-access.ts";
import { listFlowSteps } from "./workflows.ts";

/**
 * P10-D1 consented replay-event ledger (smallest replay grain).
 *
 * Records rrweb-compatible event sequences per flow through explicit
 * sessions with deterministic per-session ordering, then replays them
 * back in order. No donor code is vendored: only the event envelope
 * shape (numeric type, millisecond timestamp, data object) mirrors the
 * rrweb event contract. Sensitive input values are masked in the
 * Skelet-owned record path before storage; raw keystrokes, passwords,
 * and tokens never reach the ledger.
 *
 * Visibility reuses the flow readability rule (every step artifact must
 * be readable through the AF-SEC-00 central gate): sessions for
 * unreadable flows cannot be opened, and replay reads re-check both the
 * opening actor and current readability, answering null without an
 * oracle. Budgets bound every session (event count and bytes).
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EVENTS_PER_SESSION = 2_000;
const MAX_BYTES_PER_SESSION = 2 * 1024 * 1024;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_DATA_BYTES = 64 * 1024;
const SENSITIVE_TAG_PATTERN = /credential|password|token|secret|ssn|card/i;

export const REPLAY_EVENT_TYPES = [0, 1, 2, 3, 4, 5] as const;
export const REPLAY_INPUT_SOURCE = 5;

export class ReplayError extends Error {
  readonly code:
    | "replay/invalid-input"
    | "replay/not-found"
    | "replay/closed"
    | "replay/budget-exceeded";
  constructor(code: ReplayError["code"], message: string) {
    super(message);
    this.name = "ReplayError";
    this.code = code;
  }
}

function fail(code: ReplayError["code"], message: string): never {
  throw new ReplayError(code, message);
}

export interface ReplayEventInput {
  type: number;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface ReplaySession {
  id: string;
  flowId: string;
  workspaceId: string | undefined;
  openedBy: string;
  status: "open" | "closed";
  eventCount: number;
  byteCount: number;
}

function validateActor(actorId: unknown): string {
  if (typeof actorId !== "string" || actorId.length === 0) {
    fail("replay/invalid-input", "Replay actor is invalid.");
  }
  return actorId;
}

function validateFlowId(flowId: unknown): string {
  if (typeof flowId !== "string" || !UUID_PATTERN.test(flowId)) {
    fail("replay/invalid-input", "Replay flow is invalid.");
  }
  return flowId;
}

function validateWorkspace(workspaceId: unknown): string | undefined {
  if (workspaceId === undefined) return undefined;
  if (typeof workspaceId !== "string" || !UUID_PATTERN.test(workspaceId)) {
    fail("replay/invalid-input", "Replay workspace is invalid.");
  }
  return workspaceId;
}

/** Strict envelope validation: numeric type, millisecond timestamp, data object. */
export function validateReplayEvent(raw: unknown): ReplayEventInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("replay/invalid-input", "Replay event is invalid.");
  }
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 3 || keys[0] !== "data" || keys[1] !== "timestamp" || keys[2] !== "type") {
    fail("replay/invalid-input", "Replay event carries unsupported fields.");
  }
  if (!Number.isInteger(record.type) || !(REPLAY_EVENT_TYPES as readonly number[]).includes(record.type as number)) {
    fail("replay/invalid-input", "Replay event type is invalid.");
  }
  if (!Number.isInteger(record.timestamp) || (record.timestamp as number) < 0) {
    fail("replay/invalid-input", "Replay event timestamp is invalid.");
  }
  if (typeof record.data !== "object" || record.data === null || Array.isArray(record.data)) {
    fail("replay/invalid-input", "Replay event data is invalid.");
  }
  const bytes = Buffer.byteLength(JSON.stringify(record.data), "utf8");
  if (bytes > MAX_DATA_BYTES) {
    fail("replay/invalid-input", "Replay event data exceeds its budget.");
  }
  const envelopeBytes = Buffer.byteLength(JSON.stringify(raw), "utf8");
  if (envelopeBytes > MAX_EVENT_BYTES) {
    fail("replay/invalid-input", "Replay event exceeds its budget.");
  }
  return { type: record.type as number, timestamp: record.timestamp as number, data: record.data as Record<string, unknown> };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function maskSerializedNode(node: unknown): void {
  if (!isRecord(node)) return;
  const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : null;
  if (tag === "input" || tag === "textarea" || tag === "select") {
    if (isRecord(node.attributes)) {
      delete node.attributes.value;
      delete node.attributes.checked;
    }
    if (typeof node.textContent === "string") node.textContent = "***";
  }
  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) maskSerializedNode(child);
  }
  if (Array.isArray(node.adds)) {
    for (const add of node.adds) {
      if (isRecord(add) && "node" in add) maskSerializedNode(add.node);
    }
  }
}

/**
 * Mask sensitive values before storage. Input-source events lose their
 * typed text (checked state is preserved); serialized input elements in
 * mutations lose values and text; custom events whose tag or payload keys
 * look like credentials are replaced with a redaction marker.
 */
export function maskReplayEvent(event: ReplayEventInput): ReplayEventInput {
  const data = JSON.parse(JSON.stringify(event.data)) as Record<string, unknown>;
  if (event.type === 3 && data.source === REPLAY_INPUT_SOURCE) {
    if (typeof data.text === "string") data.text = "***";
    if (typeof data.textContent === "string") data.textContent = "***";
    return { type: event.type, timestamp: event.timestamp, data };
  }
  if (event.type === 3 && data.source === 0) {
    maskSerializedNode(data);
  }
  if (event.type === 5) {
    const tag = typeof data.tag === "string" ? data.tag : "";
    const payload = isRecord(data.payload) ? data.payload : null;
    const tagged = SENSITIVE_TAG_PATTERN.test(tag);
    const keyed = payload !== null && Object.keys(payload).some((key) => SENSITIVE_TAG_PATTERN.test(key));
    if (tagged || keyed) {
      return { type: event.type, timestamp: event.timestamp, data: { tag: "redacted", payload: { redacted: true } } };
    }
  }
  return { type: event.type, timestamp: event.timestamp, data };
}

function rowToSession(row: Record<string, unknown>): ReplaySession {
  return {
    id: String(row.id),
    flowId: String(row.flow_id),
    workspaceId: row.workspace_id == null ? undefined : String(row.workspace_id),
    openedBy: String(row.opened_by),
    status: row.status === "closed" ? "closed" : "open",
    eventCount: Number(row.event_count),
    byteCount: Number(row.byte_count),
  };
}

async function flowReadable(tx: DbTransaction, flowId: string, actorId: string): Promise<boolean> {
  const found = await tx.query(`select id from flows where id = $1`, [flowId]);
  if (found.rows.length === 0) return false;
  const steps = await listFlowSteps(tx, flowId);
  for (const step of steps) {
    if ((await getArtifactForActor(tx, step.artifactId, actorId)) === null) return false;
  }
  return true;
}

async function loadSession(tx: DbTransaction, sessionId: string): Promise<ReplaySession | null> {
  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) {
    fail("replay/invalid-input", "Replay session is invalid.");
  }
  const found = await tx.query(`select * from replay_sessions where id = $1`, [sessionId]);
  if (found.rows.length === 0) return null;
  return rowToSession(found.rows[0] as Record<string, unknown>);
}

export async function openReplaySession(
  tx: DbTransaction,
  input: { flowId: string; actorId: string; workspaceId?: string | undefined; consent: unknown },
): Promise<ReplaySession | null> {
  const actorId = validateActor(input.actorId);
  const flowId = validateFlowId(input.flowId);
  const workspaceId = validateWorkspace(input.workspaceId);
  if (input.consent !== "explicit") {
    fail("replay/invalid-input", "Replay recording requires explicit consent.");
  }
  if (!(await flowReadable(tx, flowId, actorId))) return null;
  const result = await tx.query(
    `insert into replay_sessions (flow_id, workspace_id, opened_by, consent)
     values ($1, $2, $3, 'explicit') returning *`,
    [flowId, workspaceId ?? null, actorId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (row === undefined) fail("replay/not-found", "Replay session was not created.");
  return rowToSession(row as Record<string, unknown>);
}

export async function recordReplayEvents(
  tx: DbTransaction,
  input: { sessionId: string; actorId: string; events: unknown },
): Promise<{ recorded: number; eventCount: number; byteCount: number } | null> {
  const actorId = validateActor(input.actorId);
  if (!Array.isArray(input.events) || input.events.length === 0 || input.events.length > MAX_EVENTS_PER_SESSION) {
    fail("replay/invalid-input", "Replay event batch is invalid.");
  }
  const session = await loadSession(tx, input.sessionId);
  if (session === null) return null;
  if (session.openedBy !== actorId) return null;
  if (session.status !== "open") {
    fail("replay/closed", "Replay session is closed.");
  }
  if (!(await flowReadable(tx, session.flowId, actorId))) return null;
  const masked = (input.events as unknown[]).map((raw) => maskReplayEvent(validateReplayEvent(raw)));
  let bytes = 0;
  for (const event of masked) {
    bytes += Buffer.byteLength(JSON.stringify(event), "utf8");
  }
  if (session.eventCount + masked.length > MAX_EVENTS_PER_SESSION) {
    fail("replay/budget-exceeded", "Replay session exceeds its event budget.");
  }
  if (session.byteCount + bytes > MAX_BYTES_PER_SESSION) {
    fail("replay/budget-exceeded", "Replay session exceeds its byte budget.");
  }
  const existing = await tx.query(`select coalesce(max(seq), -1) as top from replay_events where session_id = $1`, [
    session.id,
  ]);
  let seq = Number((existing.rows[0] as Record<string, unknown>).top) + 1;
  // Budget gates run before the first insert, so a rejected batch leaves
  // zero writes. Callers needing multi-batch atomicity wrap record calls in
  // their own transaction boundary, matching the corpus import precedent.
  for (const event of masked) {
    await tx.query(`insert into replay_events (session_id, seq, event) values ($1, $2, $3::jsonb)`, [
      session.id,
      seq,
      JSON.stringify(event),
    ]);
    seq += 1;
  }
  await tx.query(
    `update replay_sessions set event_count = event_count + $1, byte_count = byte_count + $2 where id = $3`,
    [masked.length, bytes, session.id],
  );
  return { recorded: masked.length, eventCount: session.eventCount + masked.length, byteCount: session.byteCount + bytes };
}

export async function closeReplaySession(
  tx: DbTransaction,
  input: { sessionId: string; actorId: string },
): Promise<ReplaySession | null> {
  const actorId = validateActor(input.actorId);
  const session = await loadSession(tx, input.sessionId);
  if (session === null || session.openedBy !== actorId) return null;
  if (session.status === "closed") return session;
  const result = await tx.query(
    `update replay_sessions set status = 'closed', closed_at = now() where id = $1 returning *`,
    [session.id],
  );
  return rowToSession(result.rows[0] as Record<string, unknown>);
}

export async function getReplayEvents(
  tx: DbTransaction,
  input: { sessionId: string; actorId: string },
): Promise<{ session: ReplaySession; events: ReplayEventInput[] } | null> {
  const actorId = validateActor(input.actorId);
  const session = await loadSession(tx, input.sessionId);
  if (session === null || session.openedBy !== actorId) return null;
  if (!(await flowReadable(tx, session.flowId, actorId))) return null;
  const rows = (
    await tx.query(`select event from replay_events where session_id = $1 order by seq asc`, [session.id])
  ).rows as Record<string, unknown>[];
  return {
    session,
    events: rows.map((row) => {
      const parsed = typeof row.event === "string" ? JSON.parse(row.event as string) : row.event;
      return parsed as ReplayEventInput;
    }),
  };
}
