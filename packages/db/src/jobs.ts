import type { DbTransaction } from "./db.ts";

/**
 * G05-01 job queue lifecycle: PostgreSQL-backed enqueue, ordered claim,
 * completion, retry with deterministic backoff, cancellation, and
 * dead-letter state. Every transition is a single conditional statement,
 * so concurrent workers converge through row locks instead of
 * application-level coordination. Provider execution and worker runtimes
 * arrive in later grains; they share this durable lifecycle.
 */

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "dead";

export interface Job {
  id: string;
  queue: string;
  kind: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  idempotencyKey: string | null;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lockedBy: string | null;
  lockedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export class JobError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "JobError";
    this.code = code;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BACKOFF_BASE_SECONDS = 60;
const BACKOFF_MAX_SECONDS = 3600;

/** Deterministic exponential backoff in seconds for the nth failed attempt (1-based). */
export function computeBackoffSeconds(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new JobError("jobs/invalid-job", "Retry attempt is invalid.");
  }
  return Math.min(BACKOFF_BASE_SECONDS * 2 ** (attempt - 1), BACKOFF_MAX_SECONDS);
}

function toIsoTimestamp(raw: unknown): string {
  const value = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(value.getTime())) {
    throw new Error("Invalid job timestamp");
  }
  return value.toISOString();
}

function toStatus(value: unknown): JobStatus {
  if (
    value !== "queued" &&
    value !== "running" &&
    value !== "completed" &&
    value !== "failed" &&
    value !== "canceled" &&
    value !== "dead"
  ) {
    throw new Error("Invalid job status in database");
  }
  return value;
}

function toJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    queue: String(row.queue),
    kind: String(row.kind),
    payload:
      typeof row.payload === "string"
        ? (JSON.parse(row.payload) as Record<string, unknown>)
        : (row.payload as Record<string, unknown>),
    status: toStatus(row.status),
    idempotencyKey: row.idempotency_key === null ? null : String(row.idempotency_key),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    runAt: toIsoTimestamp(row.run_at),
    lockedBy: row.locked_by === null ? null : String(row.locked_by),
    lockedAt: row.locked_at === null ? null : toIsoTimestamp(row.locked_at),
    lastError: row.last_error === null ? null : String(row.last_error),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

const JOB_COLUMNS =
  `id, queue, kind, payload, status, idempotency_key, attempts,
   max_attempts, run_at, locked_by, locked_at, last_error, created_at, updated_at`;

function validateName(field: string, value: string): string {
  if (typeof value !== "string") {
    throw new JobError("jobs/invalid-job", `Job ${field} is invalid.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    throw new JobError("jobs/invalid-job", `Job ${field} is invalid.`);
  }
  return trimmed;
}

function invalidId(): JobError {
  return new JobError("jobs/not-found", "Job was not found.");
}

/**
 * Enqueue a job. A repeated idempotency key converges to the original row
 * (reported with enqueued:false); a null key always creates a new row.
 */
export async function enqueue(
  tx: DbTransaction,
  input: {
    queue: string;
    kind: string;
    payload?: Record<string, unknown>;
    idempotencyKey?: string | null;
    maxAttempts?: number;
    runAt?: Date;
  },
): Promise<{ job: Job; enqueued: boolean }> {
  const queue = validateName("queue", input.queue);
  const kind = validateName("kind", input.kind);
  const maxAttempts = input.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new JobError("jobs/invalid-job", "Job retry budget is invalid.");
  }
  const key = input.idempotencyKey ?? null;
  if (key !== null && (key.trim().length === 0 || key.length > 256)) {
    throw new JobError("jobs/invalid-job", "Job identity key is invalid.");
  }
  const runAt = input.runAt ?? new Date();
  if (Number.isNaN(runAt.getTime())) {
    throw new JobError("jobs/invalid-job", "Job schedule is invalid.");
  }
  if (input.payload !== undefined && (typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload))) {
    throw new JobError("jobs/invalid-job", "Job payload is invalid.");
  }
  const inserted = await tx.query(
    `insert into jobs (queue, kind, payload, idempotency_key, max_attempts, run_at)
     values ($1, $2, $3::jsonb, $4, $5, $6::timestamptz)
     on conflict (idempotency_key) do nothing
     returning ${JOB_COLUMNS}`,
    [queue, kind, JSON.stringify(input.payload ?? {}), key, maxAttempts, runAt.toISOString()],
  );
  const row = inserted.rows[0];
  if (row !== undefined) {
    return { job: toJob(row), enqueued: true };
  }
  // A null key never conflicts; reaching here means a duplicate key.
  const existing = await tx.query(
    `select ${JOB_COLUMNS} from jobs where idempotency_key = $1`,
    [key],
  );
  const found = existing.rows[0];
  if (found === undefined) {
    throw new JobError("jobs/invalid-job", "Job identity is ambiguous.");
  }
  return { job: toJob(found), enqueued: false };
}

/**
 * Claim the oldest due job on a queue: queued jobs plus failed jobs whose
 * backoff has elapsed. Concurrent workers converge: the row lock hands
 * the job to exactly one claimant while the others skip it. Returns null
 * when nothing is due. Canceled, completed, and dead jobs are never
 * claimed.
 */
export async function claim(
  tx: DbTransaction,
  input: { queue: string; workerId: string; now?: Date },
): Promise<Job | null> {
  const queue = validateName("queue", input.queue);
  if (typeof input.workerId !== "string" || input.workerId.trim().length === 0) {
    throw new JobError("jobs/invalid-job", "Worker identity is invalid.");
  }
  const at = input.now ?? new Date();
  const claimed = await tx.query(
    `update jobs set status = 'running', attempts = attempts + 1,
       locked_by = $2, locked_at = now()
     where id = (
       select id from jobs
       where queue = $1 and status in ('queued', 'failed') and run_at <= $3::timestamptz
       order by run_at, id limit 1 for update skip locked
     )
     returning ${JOB_COLUMNS}`,
    [queue, input.workerId, at.toISOString()],
  );
  const row = claimed.rows[0];
  return row === undefined ? null : toJob(row);
}

/** Complete a job claimed by this worker; any other state fails closed. */
export async function complete(
  tx: DbTransaction,
  input: { jobId: string; workerId: string },
): Promise<Job> {
  if (!UUID_PATTERN.test(input.jobId)) {
    throw invalidId();
  }
  const done = await tx.query(
    `update jobs set status = 'completed', locked_by = null, locked_at = null, last_error = null
     where id = $1 and status = 'running' and locked_by = $2
     returning ${JOB_COLUMNS}`,
    [input.jobId, input.workerId],
  );
  const row = done.rows[0];
  if (row === undefined) {
    throw new JobError("jobs/not-claimed", "Job is not claimed by this worker.");
  }
  return toJob(row);
}

/**
 * Fail a job claimed by this worker. Attempts below budget reschedule
 * with deterministic backoff; the final attempt dead-letters the job.
 */
export async function fail(
  tx: DbTransaction,
  input: { jobId: string; workerId: string; error: string; now?: Date },
): Promise<Job> {
  if (!UUID_PATTERN.test(input.jobId)) {
    throw invalidId();
  }
  if (typeof input.error !== "string" || input.error.trim().length === 0) {
    throw new JobError("jobs/invalid-job", "Failure reason is invalid.");
  }
  const at = input.now ?? new Date();
  const current = await tx.query(
    "select attempts, max_attempts from jobs where id = $1 and status = 'running' and locked_by = $2",
    [input.jobId, input.workerId],
  );
  const found = current.rows[0];
  if (found === undefined) {
    throw new JobError("jobs/not-claimed", "Job is not claimed by this worker.");
  }
  const attempts = Number(found.attempts);
  const maxAttempts = Number(found.max_attempts);
  if (attempts >= maxAttempts) {
    const dead = await tx.query(
      `update jobs set status = 'dead', locked_by = null, locked_at = null, last_error = $2
       where id = $1 returning ${JOB_COLUMNS}`,
      [input.jobId, input.error.slice(0, 2000)],
    );
    const deadRow = dead.rows[0];
    if (deadRow === undefined) {
      throw new JobError("jobs/not-claimed", "Job is not claimed by this worker.");
    }
    return toJob(deadRow);
  }
  const retryAt = new Date(at.getTime() + computeBackoffSeconds(attempts) * 1000);
  const retry = await tx.query(
    `update jobs set status = 'failed', locked_by = null, locked_at = null,
       last_error = $2, run_at = $3::timestamptz
     where id = $1 returning ${JOB_COLUMNS}`,
    [input.jobId, input.error.slice(0, 2000), retryAt.toISOString()],
  );
  const retryRow = retry.rows[0];
  if (retryRow === undefined) {
    throw new JobError("jobs/not-claimed", "Job is not claimed by this worker.");
  }
  return toJob(retryRow);
}

/**
 * Cancel a queued, failed, or running job. Cancellation wins over an
 * in-flight worker: later completion or failure of the job is rejected
 * because it is no longer running. Completed and dead jobs are not
 * cancelable; unknown identifiers fail closed.
 */
export async function cancel(tx: DbTransaction, jobId: string): Promise<Job> {
  if (!UUID_PATTERN.test(jobId)) {
    throw invalidId();
  }
  const canceled = await tx.query(
    `update jobs set status = 'canceled', locked_by = null, locked_at = null
     where id = $1 and status in ('queued', 'failed', 'running')
     returning ${JOB_COLUMNS}`,
    [jobId],
  );
  const row = canceled.rows[0];
  if (row === undefined) {
    const existing = await tx.query("select status from jobs where id = $1", [jobId]);
    if (existing.rows.length === 0) {
      throw invalidId();
    }
    throw new JobError("jobs/not-cancelable", "Job cannot be canceled in its state.");
  }
  return toJob(row);
}

export async function getJob(tx: DbTransaction, jobId: string): Promise<Job> {
  if (!UUID_PATTERN.test(jobId)) {
    throw invalidId();
  }
  const result = await tx.query(`select ${JOB_COLUMNS} from jobs where id = $1`, [
    jobId,
  ]);
  const row = result.rows[0];
  if (row === undefined) {
    throw invalidId();
  }
  return toJob(row);
}
