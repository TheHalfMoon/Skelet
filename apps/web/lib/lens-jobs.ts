import { createHash } from "node:crypto";

import type { DbClient } from "../../../packages/db/src/db.ts";
import {
  BuildKitError,
  cancelKitRun,
  canonicalJson,
  createKitRun,
  getKitRun,
  isTerminalStatus,
  pollKitRun,
  resumeKitRun,
  retryKitRun,
  type KitCreateRequest,
  type KitProgress,
  type KitRun,
} from "../../../packages/db/src/build-kit.ts";
import {
  AgentContractError,
  newRequestId,
  observedProvenance,
  sanitizeIdempotencyKey,
  successEnvelope,
} from "./agent-contract.ts";
import type { AgentEnvelope } from "./agent-contract.ts";

/**
 * AF-05e-i Lens job lifecycle parity: the REST/MCP-shared server layer
 * over the durable Build Kit store (packages/db/src/build-kit.ts).
 *
 * Contract (skelet.agent.v1 envelopes; HTTP statuses derive from the one
 * canonical catalog in agent-contract.ts):
 * - POST create: 201 on first creation, 200 on idempotent replay.
 * - Poll (status) and inspect (get): immediate reads, always 200 with the
 *   current persisted state. Non-terminal runs are data, not transport
 *   errors, so JOB_PENDING is reserved for a future long-poll and is NOT
 *   returned here. Terminal failed/canceled runs are legitimate outcomes
 *   returned as data with errorClass, NOT as JOB_FAILED.
 * - Cancel/retry/resume: 200 with the post-action state plus `applied`.
 * - Download: 200 with artifact bytes on success; 404 when the identity
 *   is unknown, outside the workspace, or the output is purged; 409 when
 *   no successful artifact exists yet (active or failed/canceled runs).
 * - Stable resource identifier: `skelet://lens/{64-hex-kit-id}` in every
 *   job view. Kit IDs are content-derived (workspace, idempotency key,
 *   request hash), so duplicate submissions converge on one URI.
 *
 * Authority: workspaceId is a client-supplied locator; membership resolved
 * from the server-bound actorId is the authority. Unknown and denied
 * identities answer alike (FORBIDDEN_OR_NOT_FOUND): no existence oracle.
 * workerId on resume is an opaque operator label for lease ownership, not
 * authentication; membership is still required.
 */

export interface RestResult {
  status: number;
  body: AgentEnvelope;
}

export interface DownloadResult {
  status: number;
  body?: AgentEnvelope;
  file?: {
    bytes: Uint8Array;
    mediaType: string;
    filename: string;
    sha256: string;
  };
}

const HEX64_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTPS_PATTERN = /^https:\/\//;
const CREATE_FIELDS = new Set([
  "workspaceId",
  "sourceUrl",
  "mode",
  "pages",
  "maxPages",
  "maxDepth",
  "maxBytes",
  "timeBudgetMs",
  "viewports",
  "idempotencyKey",
  "retentionDays",
  "maxAttempts",
]);
const DOWNLOAD_NAMES = ["manifest.json", "evidence.json"] as const;
export type DownloadName = (typeof DOWNLOAD_NAMES)[number];

export function lensUriFor(kitId: string): string {
  return `skelet://lens/${kitId}`;
}

/** Parse `skelet://lens/{64-hex-kit-id}`; anything else is INVALID_INPUT. */
export function parseLensUri(uri: unknown): string {
  if (typeof uri !== "string") {
    throw new AgentContractError("INVALID_INPUT", { message: "Lens URI is invalid." });
  }
  const match = /^skelet:\/\/lens\/([0-9a-f]{64})$/i.exec(uri.trim());
  if (match === null || !HEX64_PATTERN.test((match[1] ?? "").toLowerCase())) {
    throw new AgentContractError("INVALID_INPUT", { message: "Lens URI is invalid." });
  }
  return (match[1] ?? "").toLowerCase();
}

export interface LensJobView {
  uri: string;
  kitId: string;
  analysisId: string;
  status: string;
  revision: number;
  attempt: number;
  maxAttempts: number;
  pipelineStep: number;
  pipelineTotal: number;
  errorClass: string | null;
  purged: boolean;
  expiresAt: string;
}

export interface LensArtifactSummary {
  entries: Array<{ path: string; sha256: string; bytes: number }>;
  withheld: string[];
}

export interface LensJobDetail extends LensJobView {
  scope: Record<string, unknown>;
  sourceUrl: string;
  resultEvidence: Record<string, unknown>;
  artifactSummary: LensArtifactSummary;
  checkpointCursor: Record<string, unknown> | null;
  attemptHistory: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

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

/**
 * BuildKitError code to canonical agent error. Corrupt-row, plan, and
 * availability failures stay opaque (500): they signal operator-side
 * faults, never client-correctable states. State conflicts are 409
 * NOT_AVAILABLE; validation and idempotency conflicts are 400.
 */
function mapKitError(error: BuildKitError, requestId: string): RestResult {
  switch (error.code) {
    case "buildkit/forbidden":
    case "buildkit/not-found":
      return notFound(requestId);
    case "buildkit/quota-exhausted": {
      const err = new AgentContractError("QUOTA_EXCEEDED", { requestId });
      return { status: err.httpStatus, body: err.toFailureEnvelope() };
    }
    case "buildkit/stale-revision": {
      const err = new AgentContractError("STALE_REVISION", { requestId });
      return { status: err.httpStatus, body: err.toFailureEnvelope() };
    }
    case "buildkit/lease-held":
    case "buildkit/terminal-state":
    case "buildkit/not-cancelable":
    case "buildkit/not-retryable":
    case "buildkit/not-resumable":
    case "buildkit/not-expired":
    case "buildkit/retry-exhausted": {
      const err = new AgentContractError("NOT_AVAILABLE", { requestId });
      return { status: err.httpStatus, body: err.toFailureEnvelope() };
    }
    case "buildkit/invalid-request":
    case "buildkit/invalid-worker":
    case "buildkit/illegal-transition":
    case "buildkit/idempotency-conflict":
      return invalidInput(requestId, "Lens job request is invalid.");
    case "buildkit/invalid-row":
    case "buildkit/invalid-plan":
    case "buildkit/quota-unavailable":
    case "buildkit/unavailable":
    default:
      return opaque(requestId);
  }
}

function toFailure(error: unknown, requestId: string): RestResult {
  if (error instanceof AgentContractError) {
    const withId = new AgentContractError(error.code, {
      message: error.code === "INVALID_INPUT" ? error.safeMessage : undefined,
      requestId,
    });
    return { status: withId.httpStatus, body: withId.toFailureEnvelope() };
  }
  if (error instanceof BuildKitError) return mapKitError(error, requestId);
  if (error instanceof Error && error.name === "AuthError") return notFound(requestId);
  return opaque(requestId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJobView(progress: KitProgress): LensJobView {
  return {
    uri: lensUriFor(progress.kitId),
    kitId: progress.kitId,
    analysisId: progress.analysisId,
    status: progress.status,
    revision: progress.revision,
    attempt: progress.attempt,
    maxAttempts: progress.maxAttempts,
    pipelineStep: progress.pipelineStep,
    pipelineTotal: progress.pipelineTotal,
    errorClass: progress.errorClass,
    purged: progress.purged,
    expiresAt: progress.expiresAt,
  };
}

function toArtifactSummary(manifest: Record<string, unknown>): LensArtifactSummary {
  const entries: LensArtifactSummary["entries"] = [];
  const rawEntries = manifest.entries;
  if (Array.isArray(rawEntries)) {
    for (const entry of rawEntries) {
      if (!isRecord(entry)) continue;
      if (
        typeof entry.path !== "string" ||
        typeof entry.sha256 !== "string" ||
        typeof entry.bytes !== "number"
      ) {
        continue;
      }
      // Kit-relative paths and digests only: storage keys are never echoed.
      entries.push({ path: entry.path, sha256: entry.sha256, bytes: entry.bytes });
      if (entries.length >= 512) break;
    }
  }
  const withheld: string[] = [];
  const rawWithheld = manifest.withheld;
  if (Array.isArray(rawWithheld)) {
    for (const name of rawWithheld) {
      if (typeof name !== "string") continue;
      withheld.push(name);
      if (withheld.length >= 512) break;
    }
  }
  return { entries, withheld };
}

function toJobDetail(run: KitRun, progress: KitProgress): LensJobDetail {
  const view = toJobView(progress);
  const requestBody = run.requestBody;
  return {
    ...view,
    scope: run.scopeBudgets as unknown as Record<string, unknown>,
    sourceUrl: typeof requestBody.sourceUrl === "string" ? requestBody.sourceUrl : "",
    resultEvidence: run.purgedAt === null ? run.resultEvidence : {},
    artifactSummary: run.purgedAt === null ? toArtifactSummary(run.artifactManifest) : { entries: [], withheld: [] },
    checkpointCursor: progress.checkpointCursor,
    attemptHistory: run.attemptHistory,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
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

function checkKitId(kitId: unknown, requestId: string): RestResult | null {
  if (typeof kitId !== "string" || !HEX64_PATTERN.test(kitId.toLowerCase())) {
    return notFound(requestId);
  }
  return null;
}

function validateCreateBody(body: unknown, requestId: string): {
  ok: true;
  workspaceId: string;
  request: KitCreateRequest;
} | { ok: false; result: RestResult } {
  if (!isRecord(body)) {
    return { ok: false, result: invalidInput(requestId, "Lens job request is invalid.") };
  }
  for (const key of Object.keys(body)) {
    if (!CREATE_FIELDS.has(key)) {
      return { ok: false, result: invalidInput(requestId, "Lens job request is invalid.") };
    }
  }
  const workspaceFailed = checkWorkspace(body.workspaceId, requestId);
  if (workspaceFailed !== null) return { ok: false, result: workspaceFailed };
  if (typeof body.sourceUrl !== "string" || !HTTPS_PATTERN.test(body.sourceUrl.trim())) {
    return { ok: false, result: invalidInput(requestId, "Lens job source URL is invalid.") };
  }
  if (body.mode !== "single-page" && body.mode !== "selected-pages" && body.mode !== "bounded-sitemap") {
    return { ok: false, result: invalidInput(requestId, "Lens job capture mode is invalid.") };
  }
  if (body.pages !== undefined) {
    if (
      !Array.isArray(body.pages) ||
      body.pages.length === 0 ||
      body.pages.length > 25 ||
      body.pages.some((page) => typeof page !== "string" || page.length > 2048)
    ) {
      return { ok: false, result: invalidInput(requestId, "Lens job page list is invalid.") };
    }
  }
  for (const field of ["maxPages", "maxDepth", "maxBytes", "timeBudgetMs"] as const) {
    const value = body[field];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return { ok: false, result: invalidInput(requestId, "Lens job budgets are invalid.") };
    }
  }
  if (body.viewports !== undefined) {
    if (
      !Array.isArray(body.viewports) ||
      body.viewports.length === 0 ||
      body.viewports.length > 2 ||
      body.viewports.some((viewport) => viewport !== "desktop" && viewport !== "mobile")
    ) {
      return { ok: false, result: invalidInput(requestId, "Lens job viewports are invalid.") };
    }
  }
  // REST clamps idempotency keys to the agent idempotency convention
  // (1..128 chars, no whitespace); the store accepts up to 256.
  const key = sanitizeIdempotencyKey(body.idempotencyKey);
  if (key === undefined) {
    return { ok: false, result: invalidInput(requestId, "Lens job idempotency key is invalid.") };
  }
  if (body.retentionDays !== undefined && typeof body.retentionDays !== "number") {
    return { ok: false, result: invalidInput(requestId, "Lens job retention is invalid.") };
  }
  if (body.maxAttempts !== undefined && typeof body.maxAttempts !== "number") {
    return { ok: false, result: invalidInput(requestId, "Lens job retry budget is invalid.") };
  }
  const request: KitCreateRequest = {
    sourceUrl: (body.sourceUrl as string).trim(),
    mode: body.mode,
    maxPages: body.maxPages as number,
    maxDepth: body.maxDepth as number,
    maxBytes: body.maxBytes as number,
    timeBudgetMs: body.timeBudgetMs as number,
    idempotencyKey: key,
  };
  if (Array.isArray(body.pages)) request.pages = (body.pages as string[]).map((page) => page.trim());
  if (Array.isArray(body.viewports)) {
    request.viewports = [...new Set(body.viewports)].sort() as Array<"desktop" | "mobile">;
  }
  if (typeof body.retentionDays === "number") request.retentionDays = body.retentionDays;
  if (typeof body.maxAttempts === "number") request.maxAttempts = body.maxAttempts;
  return { ok: true, workspaceId: body.workspaceId as string, request };
}

/** POST create: idempotent; 201 on first creation, 200 on replay. */
export async function createLensJobRoute(
  db: DbClient,
  body: unknown,
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const validated = validateCreateBody(body, requestId);
  if (!validated.ok) return validated.result;
  try {
    const { run, created } = await createKitRun(db, {
      workspaceId: validated.workspaceId,
      actorId,
      request: validated.request,
    });
    const progress = await pollKitRun(db, {
      workspaceId: validated.workspaceId,
      actorId,
      kitId: run.kitId,
    });
    const payload = successEnvelope(
      requestId,
      { job: toJobView(progress), created },
      { provenance: observedProvenance(lensUriFor(run.kitId)) },
    );
    return { status: created ? 201 : 200, body: payload };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

async function loadScopedView(
  db: DbClient,
  workspaceId: string,
  actorId: string,
  kitId: string,
): Promise<{ run: KitRun; progress: KitProgress }> {
  const run = await getKitRun(db, { workspaceId, actorId, kitId });
  const progress = await pollKitRun(db, { workspaceId, actorId, kitId });
  return { run, progress };
}

/** GET poll: immediate read of the persisted progress; never 202/500 for data states. */
export async function pollLensJobRoute(
  db: DbClient,
  query: { workspaceId?: unknown; kitId?: unknown },
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const workspaceFailed = checkWorkspace(query.workspaceId, requestId);
  if (workspaceFailed !== null) return workspaceFailed;
  const kitFailed = checkKitId(query.kitId, requestId);
  if (kitFailed !== null) return kitFailed;
  try {
    const workspaceId = query.workspaceId as string;
    const kitId = (query.kitId as string).toLowerCase();
    const { progress } = await loadScopedView(db, workspaceId, actorId, kitId);
    return {
      status: 200,
      body: successEnvelope(
        requestId,
        { job: toJobView(progress) },
        { provenance: observedProvenance(lensUriFor(kitId)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

/** GET inspect: full persisted run incl. evidence and artifact summary. */
export async function getLensJobRoute(
  db: DbClient,
  query: { workspaceId?: unknown; kitId?: unknown },
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const workspaceFailed = checkWorkspace(query.workspaceId, requestId);
  if (workspaceFailed !== null) return workspaceFailed;
  const kitFailed = checkKitId(query.kitId, requestId);
  if (kitFailed !== null) return kitFailed;
  try {
    const workspaceId = query.workspaceId as string;
    const kitId = (query.kitId as string).toLowerCase();
    const { run, progress } = await loadScopedView(db, workspaceId, actorId, kitId);
    return {
      status: 200,
      body: successEnvelope(
        requestId,
        { job: toJobDetail(run, progress) },
        { provenance: observedProvenance(lensUriFor(kitId)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

/** POST cancel: deterministic; repeat cancellation returns applied:false. */
export async function cancelLensJobRoute(
  db: DbClient,
  query: { workspaceId?: unknown; kitId?: unknown },
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const workspaceFailed = checkWorkspace(query.workspaceId, requestId);
  if (workspaceFailed !== null) return workspaceFailed;
  const kitFailed = checkKitId(query.kitId, requestId);
  if (kitFailed !== null) return kitFailed;
  try {
    const workspaceId = query.workspaceId as string;
    const kitId = (query.kitId as string).toLowerCase();
    const { applied } = await cancelKitRun(db, { workspaceId, actorId, kitId });
    const progress = await pollKitRun(db, { workspaceId, actorId, kitId });
    return {
      status: 200,
      body: successEnvelope(
        requestId,
        { job: toJobView(progress), applied },
        { provenance: observedProvenance(lensUriFor(kitId)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

/** POST retry: failed/partial only, within budget; submission quota is not recharged. */
export async function retryLensJobRoute(
  db: DbClient,
  query: { workspaceId?: unknown; kitId?: unknown },
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const workspaceFailed = checkWorkspace(query.workspaceId, requestId);
  if (workspaceFailed !== null) return workspaceFailed;
  const kitFailed = checkKitId(query.kitId, requestId);
  if (kitFailed !== null) return kitFailed;
  try {
    const workspaceId = query.workspaceId as string;
    const kitId = (query.kitId as string).toLowerCase();
    await retryKitRun(db, { workspaceId, actorId, kitId });
    const progress = await pollKitRun(db, { workspaceId, actorId, kitId });
    return {
      status: 200,
      body: successEnvelope(
        requestId,
        { job: toJobView(progress), applied: true },
        { provenance: observedProvenance(lensUriFor(kitId)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

/**
 * POST resume: transfer the lease to a worker after interruption. workerId
 * is an opaque operator label (validated shape only); membership is the
 * authority. Terminal and queued runs are not resumable (409).
 */
export async function resumeLensJobRoute(
  db: DbClient,
  query: { workspaceId?: unknown; kitId?: unknown; workerId?: unknown },
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const workspaceFailed = checkWorkspace(query.workspaceId, requestId);
  if (workspaceFailed !== null) return workspaceFailed;
  const kitFailed = checkKitId(query.kitId, requestId);
  if (kitFailed !== null) return kitFailed;
  let workerId = `web:${requestId}`;
  if (query.workerId !== undefined) {
    if (
      typeof query.workerId !== "string" ||
      query.workerId.trim().length === 0 ||
      query.workerId.trim().length > 128
    ) {
      return invalidInput(requestId, "Lens job worker identity is invalid.");
    }
    workerId = query.workerId.trim();
  }
  try {
    const workspaceId = query.workspaceId as string;
    const kitId = (query.kitId as string).toLowerCase();
    const { resumed } = await resumeKitRun(db, { workspaceId, actorId, kitId, workerId });
    const progress = await pollKitRun(db, { workspaceId, actorId, kitId });
    return {
      status: 200,
      body: successEnvelope(
        requestId,
        { job: toJobView(progress), resumed },
        { provenance: observedProvenance(lensUriFor(kitId)) },
      ),
    };
  } catch (error) {
    return toFailure(error, requestId);
  }
}

function sha256HexBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * GET artifact download. Serves canonical bytes of the persisted manifest
 * or evidence document with an integrity digest. Withheld and unknown
 * entries are never served: only the two allowlisted names resolve, and
 * only from terminal completed/partial runs with non-empty payloads.
 * Purged outputs answer 404; active or failed runs answer 409.
 */
export async function downloadLensArtifactRoute(
  db: DbClient,
  query: { workspaceId?: unknown; kitId?: unknown; name?: unknown },
  actorId: string,
  providedRequestId?: unknown,
): Promise<DownloadResult> {
  const requestId = newRequestId(providedRequestId);
  const actorFailed = checkActor(actorId, requestId);
  if (actorFailed !== null) return actorFailed;
  const workspaceFailed = checkWorkspace(query.workspaceId, requestId);
  if (workspaceFailed !== null) return workspaceFailed;
  const kitFailed = checkKitId(query.kitId, requestId);
  if (kitFailed !== null) return kitFailed;
  const name = query.name === undefined ? "manifest.json" : query.name;
  if (name !== "manifest.json" && name !== "evidence.json") {
    return invalidInput(requestId, "Lens artifact name is invalid.");
  }
  try {
    const workspaceId = query.workspaceId as string;
    const kitId = (query.kitId as string).toLowerCase();
    const { run } = await loadScopedView(db, workspaceId, actorId, kitId);
    if (run.purgedAt !== null) return notFound(requestId);
    if (!isTerminalStatus(run.status) || (run.status !== "completed" && run.status !== "partial")) {
      const err = new AgentContractError("NOT_AVAILABLE", { requestId });
      return { status: err.httpStatus, body: err.toFailureEnvelope() };
    }
    const document = name === "manifest.json" ? run.artifactManifest : run.resultEvidence;
    if (Object.keys(document).length === 0) {
      const err = new AgentContractError("NOT_AVAILABLE", { requestId });
      return { status: err.httpStatus, body: err.toFailureEnvelope() };
    }
    const bytes = new TextEncoder().encode(canonicalJson(document));
    return {
      status: 200,
      file: {
        bytes,
        mediaType: "application/json",
        filename: `lens-${kitId.slice(0, 12)}-${name}`,
        sha256: sha256HexBytes(bytes),
      },
    };
  } catch (error) {
    const failure = toFailure(error, requestId);
    return { status: failure.status, body: failure.body };
  }
}

export type { AgentEnvelope };
