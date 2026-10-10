import { createHash } from "node:crypto";
import type { DbClient, DbTransaction } from "./db.ts";
import { capabilitiesFor } from "./billing.ts";
import { requireRole } from "./workspaces.ts";

/**
 * G09b-02 AnalysisRun job lifecycle foundation for the Lens Build Kit.
 *
 * Durable nine-state lifecycle bound to the frozen
 * `skelet.lens.build-kit.v1` manifest contract (G09b-01): queued,
 * capturing, extracting, generating, validating, completed, partial,
 * failed, canceled. Tenant-scoped opaque identities, idempotent
 * submission, optimistic-concurrency revisions, worker leases with
 * expiry preemption, quota ledger, and retention/expiry with audit
 * preservation.
 *
 * Layering: user-facing operations (create, poll, cancel, retry, resume,
 * expire) require workspace membership resolved by the caller from the
 * authenticated session; this module never trusts a client workspace
 * claim as authority. Worker advancement is a server-only path scoped by
 * workspace plus opaque kit identity plus lease ownership.
 *
 * Reuse: membership from workspaces.ts, plan caps from billing.ts,
 * transactional discipline from jobs.ts (G05-01). The pre-existing
 * analysis_runs table keeps its coarse queued/running lifecycle; the
 * fine-grained Build Kit pipeline lives here so the frozen contract and
 * existing P05 semantics are never silently reinterpreted.
 */

export type KitStatus =
  | "queued"
  | "capturing"
  | "extracting"
  | "generating"
  | "validating"
  | "completed"
  | "partial"
  | "failed"
  | "canceled";

export const KIT_STATUSES: readonly KitStatus[] = [
  "queued",
  "capturing",
  "extracting",
  "generating",
  "validating",
  "completed",
  "partial",
  "failed",
  "canceled",
];

const TERMINAL_STATUSES: readonly KitStatus[] = [
  "completed",
  "partial",
  "failed",
  "canceled",
];

/**
 * Explicit allowed-transition matrix. Terminal states have no outgoing
 * transitions; failed and partial may requeue exactly once per retry
 * budget through retryKitRun, never through advanceKitRun.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<KitStatus, readonly KitStatus[]>> = {
  queued: ["capturing", "canceled"],
  capturing: ["extracting", "failed", "canceled"],
  extracting: ["generating", "failed", "canceled"],
  generating: ["validating", "partial", "failed", "canceled"],
  validating: ["completed", "partial", "failed", "canceled"],
  completed: [],
  partial: ["queued"],
  failed: ["queued"],
  canceled: [],
};

export function isTerminalStatus(status: KitStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isTransitionAllowed(from: KitStatus, to: KitStatus): boolean {
  return (
    ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
  );
}

/** Frozen G09b-01 scope bounds, mirrored here so job validation and the manifest schema cannot drift. */
export const KIT_SCOPE_BOUNDS = {
  maxPages: { min: 1, max: 25 },
  maxDepth: { min: 0, max: 3 },
  maxBytes: { min: 1, max: 52428800 },
  timeBudgetMs: { min: 1000, max: 600000 },
} as const;

const HEX64_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_CLASS_PATTERN = /^[a-z0-9][a-z0-9/_-]{0,199}$/;
const HTTPS_PATTERN = /^https:\/\//;
const RETENTION_DAYS = { min: 1, max: 90, def: 30 };
const LEASE_TTL_SECONDS = { min: 60, max: 3600, def: 300 };
const MAX_ATTEMPTS_BOUND = 5;

/**
 * Per-plan Build Kit policy (G09b-02). Submission caps reuse the billed
 * lensJobsPerMonth capability; concurrency, page, and byte caps are new
 * bounded policy defined by this grain and enforced atomically.
 */
const KIT_PLAN_CAPS: Record<string, { concurrent: number; pages: number; bytes: number }> = {
  free: { concurrent: 2, pages: 100, bytes: 104857600 },
  pro: { concurrent: 10, pages: 2500, bytes: 5368709120 },
  team: { concurrent: 50, pages: 25000, bytes: 53687091200 },
};

export class BuildKitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BuildKitError";
    this.code = code;
  }
}

export interface KitScopeBudgets {
  mode: "single-page" | "selected-pages" | "bounded-sitemap";
  maxPages: number;
  maxDepth: number;
  maxBytes: number;
  timeBudgetMs: number;
}

export interface KitCreateRequest {
  sourceUrl: string;
  mode: KitScopeBudgets["mode"];
  pages?: string[];
  maxPages: number;
  maxDepth: number;
  maxBytes: number;
  timeBudgetMs: number;
  viewports?: Array<"desktop" | "mobile">;
  idempotencyKey: string;
  retentionDays?: number;
  maxAttempts?: number;
}

export interface KitRun {
  id: string;
  workspaceId: string;
  kitId: string;
  analysisId: string;
  status: KitStatus;
  revision: number;
  idempotencyKey: string;
  requestHash: string;
  requestBody: Record<string, unknown>;
  scopeBudgets: KitScopeBudgets;
  attempt: number;
  maxAttempts: number;
  attemptHistory: Array<Record<string, unknown>>;
  checkpoint: Record<string, unknown> | null;
  resultEvidence: Record<string, unknown>;
  artifactManifest: Record<string, unknown>;
  errorClass: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  expiresAt: string;
  purgedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KitProgress {
  kitId: string;
  analysisId: string;
  status: KitStatus;
  revision: number;
  attempt: number;
  maxAttempts: number;
  pipelineStep: number;
  pipelineTotal: number;
  checkpointCursor: Record<string, unknown> | null;
  resultEvidence: Record<string, unknown>;
  errorClass: string | null;
  purged: boolean;
  expiresAt: string;
}

function notFound(): BuildKitError {
  // One generic code for missing and cross-tenant rows alike: no oracle.
  return new BuildKitError("buildkit/not-found", "Build Kit run was not found.");
}

function invalid(message: string): BuildKitError {
  return new BuildKitError("buildkit/invalid-request", message);
}

function toStatus(value: unknown): KitStatus {
  if (typeof value !== "string" || !(KIT_STATUSES as readonly string[]).includes(value)) {
    throw new BuildKitError("buildkit/invalid-row", "Build Kit run record is invalid.");
  }
  return value as KitStatus;
}

function toObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new BuildKitError("buildkit/invalid-row", `Build Kit run ${what} is invalid.`);
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BuildKitError("buildkit/invalid-row", `Build Kit run ${what} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function toArray(value: unknown, what: string): Array<Record<string, unknown>> {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new BuildKitError("buildkit/invalid-row", `Build Kit run ${what} is invalid.`);
    }
  }
  if (!Array.isArray(value)) {
    throw new BuildKitError("buildkit/invalid-row", `Build Kit run ${what} is invalid.`);
  }
  return value as Array<Record<string, unknown>>;
}

function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new BuildKitError("buildkit/invalid-row", "Build Kit run timestamp is invalid.");
  }
  return date.toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

function toRow(row: Record<string, unknown>): KitRun {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    kitId: String(row.kit_id),
    analysisId: String(row.analysis_id),
    status: toStatus(row.status),
    revision: Number(row.revision),
    idempotencyKey: String(row.idempotency_key),
    requestHash: String(row.request_hash),
    requestBody: toObject(row.request_body, "request"),
    scopeBudgets: toObject(row.scope_budgets, "scope") as unknown as KitScopeBudgets,
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    attemptHistory: toArray(row.attempt_history, "history"),
    checkpoint: row.checkpoint === null ? null : toObject(row.checkpoint, "checkpoint"),
    resultEvidence: toObject(row.result_evidence, "evidence"),
    artifactManifest: toObject(row.artifact_manifest, "manifest"),
    errorClass: row.error_class === null ? null : String(row.error_class),
    leaseOwner: row.lease_owner === null ? null : String(row.lease_owner),
    leaseExpiresAt: toIsoOrNull(row.lease_expires_at),
    expiresAt: toIso(row.expires_at),
    purgedAt: toIsoOrNull(row.purged_at),
    startedAt: toIsoOrNull(row.started_at),
    finishedAt: toIsoOrNull(row.finished_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const KIT_COLUMNS =
  `id, workspace_id, kit_id, analysis_id, status, revision, idempotency_key,
   request_hash, request_body, scope_budgets, attempt, max_attempts,
   attempt_history, checkpoint, result_evidence, artifact_manifest,
   error_class, lease_owner, lease_expires_at, expires_at, purged_at,
   started_at, finished_at, created_at, updated_at`;

/** Deterministic canonical JSON: sorted keys, compact separators, stable across platforms. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function validateUrl(value: unknown, what: string): string {
  if (typeof value !== "string") throw invalid(`${what} must be a string.`);
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 2048 ||
    !HTTPS_PATTERN.test(trimmed)
  ) {
    throw invalid(`${what} must be an https URL.`);
  }
  return trimmed;
}

function validateInt(
  value: unknown,
  what: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw invalid(`${what} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

interface NormalizedRequest {
  body: Record<string, unknown>;
  scope: KitScopeBudgets;
  requestHash: string;
  retentionDays: number;
  maxAttempts: number;
}

function normalizeRequest(input: KitCreateRequest): NormalizedRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw invalid("Request must be an object.");
  }
  const known = new Set([
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
  for (const key of Object.keys(input)) {
    if (!known.has(key)) throw invalid(`Unknown request field: ${key}.`);
  }
  const sourceUrl = validateUrl(input.sourceUrl, "Source URL");
  if (input.mode !== "single-page" && input.mode !== "selected-pages" && input.mode !== "bounded-sitemap") {
    throw invalid("Capture mode is invalid.");
  }
  const maxPages = validateInt(
    input.maxPages, "Max pages",
    KIT_SCOPE_BOUNDS.maxPages.min, KIT_SCOPE_BOUNDS.maxPages.max,
  );
  const maxDepth = validateInt(
    input.maxDepth, "Max depth",
    KIT_SCOPE_BOUNDS.maxDepth.min, KIT_SCOPE_BOUNDS.maxDepth.max,
  );
  const maxBytes = validateInt(
    input.maxBytes, "Max bytes",
    KIT_SCOPE_BOUNDS.maxBytes.min, KIT_SCOPE_BOUNDS.maxBytes.max,
  );
  const timeBudgetMs = validateInt(
    input.timeBudgetMs, "Time budget",
    KIT_SCOPE_BOUNDS.timeBudgetMs.min, KIT_SCOPE_BOUNDS.timeBudgetMs.max,
  );
  let pages: string[] | undefined;
  if (input.pages !== undefined) {
    if (!Array.isArray(input.pages) || input.pages.length > maxPages) {
      throw invalid("Page list exceeds the page budget.");
    }
    pages = input.pages.map((page) => validateUrl(page, "Page URL"));
    if (pages.length === 0) throw invalid("Page list must not be empty.");
  }
  if (input.mode === "selected-pages" && (pages === undefined || pages.length === 0)) {
    throw invalid("Selected-pages mode needs at least one page URL.");
  }
  if (input.mode === "single-page" && pages !== undefined && pages.length > 1) {
    throw invalid("Single-page mode accepts at most one page URL.");
  }
  let viewports: Array<"desktop" | "mobile"> | undefined;
  if (input.viewports !== undefined) {
    if (
      !Array.isArray(input.viewports) ||
      input.viewports.length === 0 ||
      input.viewports.length > 2
    ) {
      throw invalid("Viewports are invalid.");
    }
    const seen = new Set<string>();
    for (const viewport of input.viewports) {
      if (viewport !== "desktop" && viewport !== "mobile") {
        throw invalid("Viewports are invalid.");
      }
      seen.add(viewport);
    }
    viewports = [...seen].sort() as Array<"desktop" | "mobile">;
  }
  if (typeof input.idempotencyKey !== "string") {
    throw invalid("Idempotency key must be a string.");
  }
  const key = input.idempotencyKey.trim();
  if (key.length === 0 || key.length > 256) {
    throw invalid("Idempotency key must be 1 to 256 characters.");
  }
  const retentionDays = input.retentionDays === undefined
    ? RETENTION_DAYS.def
    : validateInt(input.retentionDays, "Retention days", RETENTION_DAYS.min, RETENTION_DAYS.max);
  const maxAttempts = input.maxAttempts === undefined
    ? 3
    : validateInt(input.maxAttempts, "Max attempts", 1, MAX_ATTEMPTS_BOUND);
  const scope: KitScopeBudgets = {
    mode: input.mode,
    maxPages,
    maxDepth,
    maxBytes,
    timeBudgetMs,
  };
  const body: Record<string, unknown> = {
    sourceUrl,
    mode: input.mode,
    ...(pages === undefined ? {} : { pages }),
    ...(viewports === undefined ? {} : { viewports }),
    maxPages,
    maxDepth,
    maxBytes,
    timeBudgetMs,
  };
  return {
    body,
    scope,
    requestHash: sha256Hex(canonicalJson(body)),
    retentionDays,
    maxAttempts,
  };
}

function deriveKitId(workspaceId: string, key: string, requestHash: string): string {
  return sha256Hex(`lens-build-kit-v1|${workspaceId}|${key}|${requestHash}`);
}

function deriveAnalysisId(kitId: string): string {
  return sha256Hex(`lens-analysis-v1|${kitId}`);
}

function validateErrorClass(value: unknown): string {
  if (typeof value !== "string" || !ERROR_CLASS_PATTERN.test(value.trim())) {
    throw invalid("Error classification is invalid.");
  }
  return value.trim();
}

function validateWorkerId(workerId: string): string {
  if (typeof workerId !== "string") {
    throw new BuildKitError("buildkit/invalid-worker", "Worker identity is invalid.");
  }
  const trimmed = workerId.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    throw new BuildKitError("buildkit/invalid-worker", "Worker identity is invalid.");
  }
  return trimmed;
}

async function resolvePlanCaps(
  tx: DbTransaction,
  workspaceId: string,
): Promise<{ concurrent: number; pages: number; bytes: number; submissions: number }> {
  const found = await tx.query(
    "select plan_key from subscriptions where workspace_id = $1",
    [workspaceId],
  );
  const plan = found.rows[0] === undefined ? "free" : String(found.rows[0].plan_key);
  const capabilities = capabilitiesFor(plan);
  const kit = KIT_PLAN_CAPS[plan] ?? KIT_PLAN_CAPS.free;
  if (kit === undefined) throw new BuildKitError("buildkit/invalid-plan", "Plan is unknown.");
  return {
    concurrent: kit.concurrent,
    pages: kit.pages,
    bytes: kit.bytes,
    submissions: capabilities.lensJobsPerMonth,
  };
}

interface QuotaRow {
  submittedTotal: number;
  activeCount: number;
  pagesReserved: number;
  bytesReserved: number;
}

async function lockQuota(tx: DbTransaction, workspaceId: string): Promise<QuotaRow> {
  await tx.query(
    `insert into lens_build_kit_quotas (workspace_id) values ($1)
     on conflict (workspace_id) do nothing`,
    [workspaceId],
  );
  const found = await tx.query(
    `select submitted_total, active_count, pages_reserved, bytes_reserved
     from lens_build_kit_quotas where workspace_id = $1 for update`,
    [workspaceId],
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new BuildKitError("buildkit/quota-unavailable", "Quota ledger is unavailable.");
  }
  return {
    submittedTotal: Number(row.submitted_total),
    activeCount: Number(row.active_count),
    pagesReserved: Number(row.pages_reserved),
    bytesReserved: Number(row.bytes_reserved),
  };
}

function quotaExhausted(message: string): BuildKitError {
  return new BuildKitError("buildkit/quota-exhausted", message);
}

/**
 * Create a Build Kit AnalysisRun. Tenant-scoped idempotency: a repeated
 * key with an identical normalized request returns the original run
 * without touching quotas; the same key with a different request fails
 * closed with an idempotency conflict. Quota reservation and the run
 * insert share one transaction.
 */
export async function createKitRun(
  client: DbClient,
  input: { workspaceId: string; actorId: string; request: KitCreateRequest; now?: Date },
): Promise<{ run: KitRun; created: boolean }> {
  if (!UUID_PATTERN.test(input.workspaceId)) {
    throw new BuildKitError("buildkit/forbidden", "Access denied.");
  }
  const normalized = normalizeRequest(input.request);
  const key = input.request.idempotencyKey.trim();
  const kitId = deriveKitId(input.workspaceId, key, normalized.requestHash);
  const analysisId = deriveAnalysisId(kitId);
  const at = input.now ?? new Date();
  if (Number.isNaN(at.getTime())) throw invalid("Timestamp is invalid.");
  return client.transaction(async (tx) => {
    await requireRole(tx, input.workspaceId, input.actorId, "member");
    const replay = await tx.query(
      `select ${KIT_COLUMNS} from lens_build_kit_runs
       where workspace_id = $1 and idempotency_key = $2`,
      [input.workspaceId, key],
    );
    const prior = replay.rows[0];
    if (prior !== undefined) {
      if (String(prior.request_hash) !== normalized.requestHash) {
        throw new BuildKitError(
          "buildkit/idempotency-conflict",
          "Idempotency key was already used with a different request.",
        );
      }
      return { run: toRow(prior), created: false };
    }
    const caps = await resolvePlanCaps(tx, input.workspaceId);
    const quota = await lockQuota(tx, input.workspaceId);
    if (quota.submittedTotal + 1 > caps.submissions) {
      throw quotaExhausted("Submission quota is exhausted.");
    }
    if (quota.activeCount + 1 > caps.concurrent) {
      throw quotaExhausted("Concurrent job quota is exhausted.");
    }
    if (quota.pagesReserved + normalized.scope.maxPages > caps.pages) {
      throw quotaExhausted("Page quota is exhausted.");
    }
    if (quota.bytesReserved + normalized.scope.maxBytes > caps.bytes) {
      throw quotaExhausted("Byte quota is exhausted.");
    }
    await tx.query(
      `update lens_build_kit_quotas set
         submitted_total = submitted_total + 1,
         active_count = active_count + 1,
         pages_reserved = pages_reserved + $2,
         bytes_reserved = bytes_reserved + $3,
         updated_at = now()
       where workspace_id = $1`,
      [input.workspaceId, normalized.scope.maxPages, normalized.scope.maxBytes],
    );
    const expiresAt = new Date(at.getTime() + normalized.retentionDays * 86400000).toISOString();
    // A concurrent duplicate key may win the insert first: converge to
    // the winner with ON CONFLICT DO NOTHING plus re-select (the
    // re-select waits for the winner's commit). If the winner rolled
    // back, retry the insert a bounded number of times. A loser that
    // converges to the winner compensates its quota reservation first,
    // so races never leak ledger charges.
    const compensate = async (): Promise<void> => {
      await tx.query(
        `update lens_build_kit_quotas set
           submitted_total = submitted_total - 1,
           active_count = active_count - 1,
           pages_reserved = pages_reserved - $2,
           bytes_reserved = bytes_reserved - $3,
           updated_at = now()
         where workspace_id = $1`,
        [input.workspaceId, normalized.scope.maxPages, normalized.scope.maxBytes],
      );
    };
    for (let round = 0; round < 3; round += 1) {
      const inserted = await tx.query(
        `insert into lens_build_kit_runs
           (workspace_id, kit_id, analysis_id, idempotency_key, request_hash,
            request_body, scope_budgets, max_attempts, expires_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::timestamptz)
         on conflict (workspace_id, idempotency_key) do nothing
         returning ${KIT_COLUMNS}`,
        [
          input.workspaceId,
          kitId,
          analysisId,
          key,
          normalized.requestHash,
          JSON.stringify(normalized.body),
          JSON.stringify(normalized.scope),
          normalized.maxAttempts,
          expiresAt,
        ],
      );
      const row = inserted.rows[0];
      if (row !== undefined) return { run: toRow(row), created: true };
      const winner = await tx.query(
        `select ${KIT_COLUMNS} from lens_build_kit_runs
         where workspace_id = $1 and idempotency_key = $2`,
        [input.workspaceId, key],
      );
      const found = winner.rows[0];
      if (found !== undefined) {
        if (String(found.request_hash) !== normalized.requestHash) {
          await compensate();
          throw new BuildKitError(
            "buildkit/idempotency-conflict",
            "Idempotency key was already used with a different request.",
          );
        }
        await compensate();
        return { run: toRow(found), created: false };
      }
    }
    await compensate();
    throw new BuildKitError("buildkit/unavailable", "Build Kit run could not be created.");
  });
}

async function loadScoped(
  tx: DbTransaction,
  workspaceId: string,
  kitId: string,
  lock: boolean,
): Promise<KitRun> {
  if (
    !UUID_PATTERN.test(workspaceId) ||
    typeof kitId !== "string" ||
    !HEX64_PATTERN.test(kitId)
  ) {
    throw notFound();
  }
  const found = await tx.query(
    `select ${KIT_COLUMNS} from lens_build_kit_runs
     where workspace_id = $1 and kit_id = $2${lock ? " for update" : ""}`,
    [workspaceId, kitId],
  );
  const row = found.rows[0];
  if (row === undefined) throw notFound();
  return toRow(row);
}

function toProgress(run: KitRun): KitProgress {
  const order: readonly KitStatus[] = [
    "queued",
    "capturing",
    "extracting",
    "generating",
    "validating",
    "completed",
  ];
  const step = order.includes(run.status) ? order.indexOf(run.status) : order.length - 1;
  return {
    kitId: run.kitId,
    analysisId: run.analysisId,
    status: run.status,
    revision: run.revision,
    attempt: run.attempt,
    maxAttempts: run.maxAttempts,
    pipelineStep: step,
    pipelineTotal: order.length - 1,
    checkpointCursor: run.checkpoint === null
      ? null
      : (run.checkpoint.cursor as Record<string, unknown> | undefined ?? null),
    resultEvidence: run.purgedAt === null ? run.resultEvidence : {},
    errorClass: run.errorClass,
    purged: run.purgedAt !== null,
    expiresAt: run.expiresAt,
  };
}

/**
 * Read the current run state with typed progress. Membership-gated and
 * workspace-scoped: cross-tenant identifiers fail closed as not-found.
 */
export async function pollKitRun(
  tx: DbTransaction,
  input: { workspaceId: string; actorId: string; kitId: string },
): Promise<KitProgress> {
  await requireRole(tx, input.workspaceId, input.actorId, "member");
  return toProgress(await loadScoped(tx, input.workspaceId, input.kitId, false));
}

/** Full run record for the owning workspace; same isolation as poll. */
export async function getKitRun(
  tx: DbTransaction,
  input: { workspaceId: string; actorId: string; kitId: string },
): Promise<KitRun> {
  await requireRole(tx, input.workspaceId, input.actorId, "member");
  return loadScoped(tx, input.workspaceId, input.kitId, false);
}

function leaseExpired(run: KitRun, at: number): boolean {
  if (run.leaseOwner === null || run.leaseExpiresAt === null) return true;
  return Date.parse(run.leaseExpiresAt) <= at;
}

async function releaseQuota(
  tx: DbTransaction,
  workspaceId: string,
  scope: KitScopeBudgets,
): Promise<void> {
  await tx.query(
    `update lens_build_kit_quotas set
       active_count = active_count - 1,
       pages_reserved = pages_reserved - $2,
       bytes_reserved = bytes_reserved - $3,
       updated_at = now()
     where workspace_id = $1`,
    [workspaceId, scope.maxPages, scope.maxBytes],
  );
}

async function reserveActiveSlot(
  tx: DbTransaction,
  workspaceId: string,
  scope: KitScopeBudgets,
): Promise<void> {
  const caps = await resolvePlanCaps(tx, workspaceId);
  const quota = await lockQuota(tx, workspaceId);
  if (quota.activeCount + 1 > caps.concurrent) {
    throw quotaExhausted("Concurrent job quota is exhausted.");
  }
  if (quota.pagesReserved + scope.maxPages > caps.pages) {
    throw quotaExhausted("Page quota is exhausted.");
  }
  if (quota.bytesReserved + scope.maxBytes > caps.bytes) {
    throw quotaExhausted("Byte quota is exhausted.");
  }
  await tx.query(
    `update lens_build_kit_quotas set
       active_count = active_count + 1,
       pages_reserved = pages_reserved + $2,
       bytes_reserved = bytes_reserved + $3,
       updated_at = now()
     where workspace_id = $1`,
    [workspaceId, scope.maxPages, scope.maxBytes],
  );
}

export interface AdvanceOptions {
  evidence?: Record<string, unknown>;
  errorClass?: string;
  artifactManifest?: Record<string, unknown>;
  checkpoint?: Record<string, unknown>;
  leaseTtlSeconds?: number;
  now?: Date;
}

/**
 * Same-state progress refresh: checkpoint and evidence accumulate and
 * the lease renews without moving the pipeline. Artifact publication
 * and error classification are forbidden here; they belong to real
 * transitions so success can never be staged through a heartbeat.
 */
async function refreshProgress(
  tx: DbTransaction,
  input: {
    run: KitRun;
    workspaceId: string;
    workerId: string;
    at: Date;
    ttl: number;
    options: AdvanceOptions;
  },
): Promise<{ run: KitRun; applied: boolean }> {
  const { run, workspaceId, workerId, at, ttl, options } = input;
  if (options.artifactManifest !== undefined || options.errorClass !== undefined) {
    throw invalid("Progress refresh cannot publish artifacts or errors.");
  }
  if (!leaseExpired(run, at.getTime()) && run.leaseOwner !== workerId) {
    throw new BuildKitError("buildkit/lease-held", "Run is leased by another worker.");
  }
  const updated = await tx.query(
    `update lens_build_kit_runs set
       revision = revision + 1,
       checkpoint = case when $4::jsonb is null then checkpoint else $4::jsonb end,
       result_evidence = case when $5::jsonb is null then result_evidence else $5::jsonb end,
       lease_owner = $6, lease_expires_at = $7::timestamptz
     where kit_id = $1 and workspace_id = $2 and revision = $3
     returning ${KIT_COLUMNS}`,
    [
      run.kitId,
      workspaceId,
      run.revision,
      options.checkpoint === undefined ? null : JSON.stringify(options.checkpoint),
      options.evidence === undefined ? null : JSON.stringify(options.evidence),
      workerId,
      new Date(at.getTime() + ttl * 1000).toISOString(),
    ],
  );
  const row = updated.rows[0];
  if (row === undefined) {
    throw new BuildKitError("buildkit/stale-revision", "Run revision is stale.");
  }
  return { run: toRow(row), applied: true };
}

/**
 * Server-only worker transition with optimistic concurrency. The caller
 * presents the revision it observed; a stale revision fails closed so
 * concurrent workers converge instead of overwriting each other.
 * Terminal re-application of the same state is deterministic and free;
 * resurrecting a terminal run is rejected.
 */
export async function advanceKitRun(
  client: DbClient,
  input: {
    workspaceId: string;
    kitId: string;
    workerId: string;
    expectedRevision: number;
    next: KitStatus;
    options?: AdvanceOptions;
  },
): Promise<{ run: KitRun; applied: boolean }> {
  const workerId = validateWorkerId(input.workerId);
  const options = input.options ?? {};
  const at = options.now ?? new Date();
  if (Number.isNaN(at.getTime())) throw invalid("Timestamp is invalid.");
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw invalid("Expected revision is invalid.");
  }
  const ttl = options.leaseTtlSeconds === undefined
    ? LEASE_TTL_SECONDS.def
    : options.leaseTtlSeconds;
  if (!Number.isInteger(ttl) || ttl < LEASE_TTL_SECONDS.min || ttl > LEASE_TTL_SECONDS.max) {
    throw invalid("Lease TTL is invalid.");
  }
  if (options.evidence !== undefined) toObject(options.evidence, "evidence");
  if (options.artifactManifest !== undefined) toObject(options.artifactManifest, "manifest");
  if (options.checkpoint !== undefined) toObject(options.checkpoint, "checkpoint");
  const errorClass = options.errorClass === undefined
    ? null
    : validateErrorClass(options.errorClass);
  return client.transaction(async (tx) => {
    const run = await loadScoped(tx, input.workspaceId, input.kitId, true);
    if (isTerminalStatus(run.status)) {
      if (run.status === input.next) return { run, applied: false };
      throw new BuildKitError("buildkit/terminal-state", "Terminal run cannot be modified.");
    }
    if (run.revision !== input.expectedRevision) {
      throw new BuildKitError("buildkit/stale-revision", "Run revision is stale.");
    }
    if (input.next === run.status) {
      return refreshProgress(tx, {
        run, workspaceId: input.workspaceId, workerId, at, ttl, options,
      });
    }
    if (!isTransitionAllowed(run.status, input.next)) {
      throw new BuildKitError("buildkit/illegal-transition", "Run transition is not allowed.");
    }
    // Lease discipline: capture acquires the lease; later steps need the
    // owner or an expired lease (crash preemption). Cancellation clears
    // the lease and always wins over in-flight workers.
    if (input.next !== "canceled" && !leaseExpired(run, at.getTime()) && run.leaseOwner !== workerId) {
      throw new BuildKitError("buildkit/lease-held", "Run is leased by another worker.");
    }
    const active = !isTerminalStatus(input.next);
    if (errorClass === null && input.next === "failed") {
      throw invalid("Failed runs need an error classification.");
    }
    if (input.next === "completed") {
      const manifest = options.artifactManifest ?? run.artifactManifest;
      if (Object.keys(manifest).length === 0) {
        throw invalid("Completed runs need validated artifacts.");
      }
      const evidence = options.evidence ?? run.resultEvidence;
      if (Object.keys(evidence).length === 0) {
        throw invalid("Completed runs need validation evidence.");
      }
    }
    if (input.next === "partial") {
      const evidence = options.evidence ?? run.resultEvidence;
      const gaps = (evidence.coverage_gaps as unknown) ?? (evidence.coverageGaps as unknown);
      if (
        (typeof gaps !== "object" || gaps === null || (Array.isArray(gaps) && gaps.length === 0)) &&
        errorClass === null &&
        run.errorClass === null
      ) {
        throw invalid("Partial runs need coverage gaps or an error classification.");
      }
    }
    const leaseExpiresAt = active
      ? new Date(at.getTime() + ttl * 1000).toISOString()
      : null;
    const updated = await tx.query(
      `update lens_build_kit_runs set
         status = $3, revision = revision + 1,
         checkpoint = case when $4::jsonb is null then checkpoint else $4::jsonb end,
         result_evidence = case when $5::jsonb is null then result_evidence else $5::jsonb end,
         artifact_manifest = case when $6::jsonb is null then artifact_manifest else $6::jsonb end,
         error_class = $7,
         lease_owner = case when $8 then null else $9 end,
         lease_expires_at = case when $8 then null else $10::timestamptz end,
         started_at = case when $3 = 'capturing' then $11::timestamptz else started_at end,
         finished_at = case when $3 in ('completed', 'partial', 'failed', 'canceled')
           then $11::timestamptz else null end
       where kit_id = $1 and workspace_id = $2 and revision = $12
       returning ${KIT_COLUMNS}`,
      [
        input.kitId,
        input.workspaceId,
        input.next,
        options.checkpoint === undefined ? null : JSON.stringify(options.checkpoint),
        options.evidence === undefined ? null : JSON.stringify(options.evidence),
        options.artifactManifest === undefined ? null : JSON.stringify(options.artifactManifest),
        // A canceled worker step keeps any pre-existing classification for audit.
        input.next === "canceled" ? (errorClass ?? run.errorClass) : errorClass,
        !active,
        workerId,
        leaseExpiresAt,
        at.toISOString(),
        run.revision,
      ],
    );
    const row = updated.rows[0];
    if (row === undefined) {
      throw new BuildKitError("buildkit/stale-revision", "Run revision is stale.");
    }
    const next = toRow(row);
    if (!active) await releaseQuota(tx, input.workspaceId, next.scopeBudgets);
    return { run: next, applied: true };
  });
}

/**
 * Cancel a run. Repeat cancellation is deterministic and free; terminal
 * completed/partial/failed runs are not cancelable; cancel wins over
 * in-flight workers because their later advances hit the terminal guard.
 */
export async function cancelKitRun(
  client: DbClient,
  input: { workspaceId: string; actorId: string; kitId: string; now?: Date },
): Promise<{ run: KitRun; applied: boolean }> {
  const at = input.now ?? new Date();
  if (Number.isNaN(at.getTime())) throw invalid("Timestamp is invalid.");
  return client.transaction(async (tx) => {
    await requireRole(tx, input.workspaceId, input.actorId, "member");
    const run = await loadScoped(tx, input.workspaceId, input.kitId, true);
    if (run.status === "canceled") return { run, applied: false };
    if (isTerminalStatus(run.status)) {
      throw new BuildKitError("buildkit/not-cancelable", "Run cannot be canceled in its state.");
    }
    const updated = await tx.query(
      `update lens_build_kit_runs set
         status = 'canceled', revision = revision + 1,
         lease_owner = null, lease_expires_at = null,
         finished_at = $3::timestamptz
       where kit_id = $1 and workspace_id = $2 and revision = $4
       returning ${KIT_COLUMNS}`,
      [input.kitId, input.workspaceId, at.toISOString(), run.revision],
    );
    const row = updated.rows[0];
    if (row === undefined) {
      throw new BuildKitError("buildkit/stale-revision", "Run revision is stale.");
    }
    const next = toRow(row);
    await releaseQuota(tx, input.workspaceId, next.scopeBudgets);
    return { run: next, applied: true };
  });
}

/**
 * Retry a failed or partial run. Canceled and completed runs are never
 * retried implicitly: cancellation is deliberate and completion is
 * final. Previous attempt evidence is preserved in attempt_history;
 * submission quota is not charged twice.
 */
export async function retryKitRun(
  client: DbClient,
  input: { workspaceId: string; actorId: string; kitId: string; now?: Date },
): Promise<KitRun> {
  const at = input.now ?? new Date();
  if (Number.isNaN(at.getTime())) throw invalid("Timestamp is invalid.");
  return client.transaction(async (tx) => {
    await requireRole(tx, input.workspaceId, input.actorId, "member");
    const run = await loadScoped(tx, input.workspaceId, input.kitId, true);
    if (run.status !== "failed" && run.status !== "partial") {
      throw new BuildKitError("buildkit/not-retryable", "Run cannot be retried in its state.");
    }
    if (run.attempt + 1 > run.maxAttempts) {
      throw new BuildKitError("buildkit/retry-exhausted", "Run retry budget is exhausted.");
    }
    await reserveActiveSlot(tx, input.workspaceId, run.scopeBudgets);
    const history = [
      ...run.attemptHistory,
      {
        attempt: run.attempt,
        from: run.status,
        errorClass: run.errorClass,
        finishedAt: run.finishedAt,
        retriedAt: at.toISOString(),
      },
    ];
    const updated = await tx.query(
      `update lens_build_kit_runs set
         status = 'queued', revision = revision + 1,
         attempt = attempt + 1, attempt_history = $3::jsonb,
         checkpoint = null, result_evidence = '{}'::jsonb,
         artifact_manifest = '{}'::jsonb, error_class = null,
         lease_owner = null, lease_expires_at = null,
         started_at = null, finished_at = null
       where kit_id = $1 and workspace_id = $2 and revision = $4
       returning ${KIT_COLUMNS}`,
      [input.kitId, input.workspaceId, JSON.stringify(history), run.revision],
    );
    const row = updated.rows[0];
    if (row === undefined) {
      throw new BuildKitError("buildkit/stale-revision", "Run revision is stale.");
    }
    return toRow(row);
  });
}

function validateCheckpoint(run: KitRun, checkpoint: Record<string, unknown>): void {
  if (checkpoint.state !== run.status) {
    throw new BuildKitError("buildkit/corrupt-checkpoint", "Checkpoint state does not match the run.");
  }
  if (checkpoint.requestHash !== run.requestHash) {
    throw new BuildKitError("buildkit/corrupt-checkpoint", "Checkpoint request does not match the run.");
  }
  const cursor = checkpoint.cursor;
  if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
    throw new BuildKitError("buildkit/corrupt-checkpoint", "Checkpoint cursor is missing.");
  }
}

/**
 * Resume interrupted work from a persisted checkpoint. A valid
 * checkpoint re-enters the same state with a transferred lease; a
 * corrupted checkpoint fails the run with a typed classification
 * instead of ever publishing success from untrusted state.
 */
export async function resumeKitRun(
  client: DbClient,
  input: {
    workspaceId: string;
    actorId: string;
    kitId: string;
    workerId: string;
    leaseTtlSeconds?: number;
    now?: Date;
  },
): Promise<{ run: KitRun; resumed: boolean }> {
  const workerId = validateWorkerId(input.workerId);
  const at = input.now ?? new Date();
  if (Number.isNaN(at.getTime())) throw invalid("Timestamp is invalid.");
  const ttl = input.leaseTtlSeconds === undefined ? LEASE_TTL_SECONDS.def : input.leaseTtlSeconds;
  if (!Number.isInteger(ttl) || ttl < LEASE_TTL_SECONDS.min || ttl > LEASE_TTL_SECONDS.max) {
    throw invalid("Lease TTL is invalid.");
  }
  return client.transaction(async (tx) => {
    await requireRole(tx, input.workspaceId, input.actorId, "member");
    const run = await loadScoped(tx, input.workspaceId, input.kitId, true);
    if (isTerminalStatus(run.status) || run.status === "queued") {
      throw new BuildKitError("buildkit/not-resumable", "Run cannot be resumed in its state.");
    }
    if (run.checkpoint === null) {
      throw new BuildKitError("buildkit/not-resumable", "Run has no checkpoint to resume from.");
    }
    try {
      validateCheckpoint(run, run.checkpoint);
    } catch (error) {
      if (error instanceof BuildKitError && error.code === "buildkit/corrupt-checkpoint") {
        const failed = await tx.query(
          `update lens_build_kit_runs set
             status = 'failed', revision = revision + 1,
             error_class = 'buildkit/corrupt-checkpoint',
             lease_owner = null, lease_expires_at = null,
             finished_at = $3::timestamptz
           where kit_id = $1 and workspace_id = $2 and revision = $4
           returning ${KIT_COLUMNS}`,
          [input.kitId, input.workspaceId, at.toISOString(), run.revision],
        );
        const row = failed.rows[0];
        if (row === undefined) {
          throw new BuildKitError("buildkit/stale-revision", "Run revision is stale.");
        }
        const next = toRow(row);
        await releaseQuota(tx, input.workspaceId, next.scopeBudgets);
        return { run: next, resumed: false };
      }
      throw error;
    }
    if (!leaseExpired(run, at.getTime()) && run.leaseOwner !== workerId) {
      throw new BuildKitError("buildkit/lease-held", "Run is leased by another worker.");
    }
    const updated = await tx.query(
      `update lens_build_kit_runs set
         revision = revision + 1,
         lease_owner = $3, lease_expires_at = $4::timestamptz
       where kit_id = $1 and workspace_id = $2 and revision = $5
       returning ${KIT_COLUMNS}`,
      [
        input.kitId,
        input.workspaceId,
        workerId,
        new Date(at.getTime() + ttl * 1000).toISOString(),
        run.revision,
      ],
    );
    const row = updated.rows[0];
    if (row === undefined) {
      throw new BuildKitError("buildkit/stale-revision", "Run revision is stale.");
    }
    return { run: toRow(row), resumed: true };
  });
}

/**
 * Enforce retention. Past expiry, an active run is canceled with the
 * expired classification and its payload is purged; a terminal run keeps
 * its audit trail (status, error, history, identities) while payload
 * columns (artifacts, checkpoints, evidence) are wiped. Re-expiry is
 * deterministic and free.
 */
export async function expireKitRun(
  client: DbClient,
  input: { workspaceId: string; actorId: string; kitId: string; now?: Date },
): Promise<{ run: KitRun; applied: boolean }> {
  const at = input.now ?? new Date();
  if (Number.isNaN(at.getTime())) throw invalid("Timestamp is invalid.");
  return client.transaction(async (tx) => {
    await requireRole(tx, input.workspaceId, input.actorId, "member");
    const run = await loadScoped(tx, input.workspaceId, input.kitId, true);
    if (run.purgedAt !== null) return { run, applied: false };
    if (Date.parse(run.expiresAt) > at.getTime()) {
      throw new BuildKitError("buildkit/not-expired", "Run has not expired yet.");
    }
    let current = run;
    if (!isTerminalStatus(run.status)) {
      const canceled = await tx.query(
        `update lens_build_kit_runs set
           status = 'canceled', revision = revision + 1,
           error_class = 'buildkit/expired',
           lease_owner = null, lease_expires_at = null,
           finished_at = $3::timestamptz
         where kit_id = $1 and workspace_id = $2 and revision = $4
         returning ${KIT_COLUMNS}`,
        [input.kitId, input.workspaceId, at.toISOString(), run.revision],
      );
      const row = canceled.rows[0];
      if (row === undefined) {
        throw new BuildKitError("buildkit/stale-revision", "Run revision is stale.");
      }
      current = toRow(row);
      await releaseQuota(tx, input.workspaceId, current.scopeBudgets);
    }
    const purged = await tx.query(
      `update lens_build_kit_runs set
         revision = revision + 1,
         artifact_manifest = '{}'::jsonb, checkpoint = null,
         result_evidence = '{}'::jsonb, purged_at = $3::timestamptz
       where kit_id = $1 and workspace_id = $2 and revision = $4
       returning ${KIT_COLUMNS}`,
      [input.kitId, input.workspaceId, at.toISOString(), current.revision],
    );
    const row = purged.rows[0];
    if (row === undefined) {
      throw new BuildKitError("buildkit/stale-revision", "Run revision is stale.");
    }
    return { run: toRow(row), applied: true };
  });
}
