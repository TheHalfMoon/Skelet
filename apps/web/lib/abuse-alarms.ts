/**
 * P15-1 abuse-alarm evaluator (Skilit-owned, no-prod-dependency).
 *
 * Operationalizes the operator alert thresholds in
 * `docs/operations/SLOS.md` as a pure deterministic function over
 * security-relevant event streams (error codes with workspace attribution
 * and timestamps) plus stuck-job counts. Operators feed it from local logs
 * and job tables; see the runbook. No network, no model, no hosted
 * dashboard: managed alerting stays deferred until a budgeted hosted offer
 * exists, and this evaluator must never be mistaken for one.
 *
 * Alarm output carries error codes, counts, and workspace IDs only — never
 * titles, request bodies, tokens, or stack traces.
 */

export type AlarmLevel = "ok" | "elevated" | "critical";

export interface AlarmEvent {
  code: string;
  workspaceId?: string | undefined;
  at: number;
}

export interface AlarmAssessment {
  level: AlarmLevel;
  alarms: { rule: string; level: Exclude<AlarmLevel, "ok">; detail: string }[];
  recommendedAction: string;
}

const FORBIDDEN_SPIKE_ELEVATED = 50;
const FORBIDDEN_SPIKE_CRITICAL = 200;
const FORBIDDEN_WINDOW_MS = 5 * 60_000;
const QUOTA_BURST_ELEVATED = 5;
const QUOTA_BURST_CRITICAL = 20;
const QUOTA_WINDOW_MS = 10 * 60_000;
const RATE_SUSTAINED_ELEVATED = 100;
const RATE_WINDOW_MS = 60_000;
const STUCK_JOBS_ELEVATED = 3;
const MAX_EVENTS = 100_000;
const MAX_WORKSPACE_CHARS = 128;

function fail(message: string): never {
  throw new Error(`Abuse alarm input is invalid: ${message}.`);
}

function validateEvents(raw: unknown): AlarmEvent[] {
  if (!Array.isArray(raw)) fail("events must be an array");
  const events = raw as unknown[];
  if (events.length > MAX_EVENTS) fail("event stream exceeds its budget");
  const out: AlarmEvent[] = [];
  for (const entry of events) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fail("event must be an object");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.code !== "string" || record.code.length === 0 || record.code.length > 64) {
      fail("event code is invalid");
    }
    if (!Number.isInteger(record.at) || (record.at as number) < 0) {
      fail("event timestamp is invalid");
    }
    if (record.workspaceId !== undefined) {
      if (
        typeof record.workspaceId !== "string" ||
        record.workspaceId.length === 0 ||
        record.workspaceId.length > MAX_WORKSPACE_CHARS
      ) {
        fail("event workspace is invalid");
      }
    }
    out.push({
      code: record.code as string,
      workspaceId: record.workspaceId as string | undefined,
      at: record.at as number,
    });
  }
  return out;
}

function validateStuckJobs(raw: unknown): number {
  if (raw === undefined) return 0;
  if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > 1_000_000) {
    fail("stuck-job count is invalid");
  }
  return raw as number;
}

function countInWindow(events: AlarmEvent[], code: string, now: number, windowMs: number): number {
  let count = 0;
  for (const event of events) {
    if (event.code === code && event.at > now - windowMs && event.at <= now) count += 1;
  }
  return count;
}

function countByWorkspace(
  events: AlarmEvent[],
  code: string,
  now: number,
  windowMs: number,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.code !== code || event.at <= now - windowMs || event.at > now) continue;
    const key = event.workspaceId ?? "unscoped";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Evaluate one event stream plus stuck-job count into a deterministic
 * alarm assessment. Pure: same inputs always produce the same output.
 */
export function evaluateAbuseAlarms(
  rawEvents: unknown,
  options?: { now?: number | undefined; stuckJobs?: number | undefined },
): AlarmAssessment {
  const events = validateEvents(rawEvents);
  const stuckJobs = validateStuckJobs(options?.stuckJobs);
  const now = options?.now !== undefined ? options.now : Date.now();
  if (!Number.isInteger(now) || now < 0) fail("reference time is invalid");

  const alarms: AlarmAssessment["alarms"] = [];

  const forbidden = countInWindow(events, "FORBIDDEN_OR_NOT_FOUND", now, FORBIDDEN_WINDOW_MS);
  if (forbidden >= FORBIDDEN_SPIKE_CRITICAL) {
    alarms.push({
      rule: "forbidden-spike",
      level: "critical",
      detail: `${forbidden} not-found answers in 5 minutes; investigate as a possible enumeration attempt.`,
    });
  } else if (forbidden >= FORBIDDEN_SPIKE_ELEVATED) {
    alarms.push({
      rule: "forbidden-spike",
      level: "elevated",
      detail: `${forbidden} not-found answers in 5 minutes; investigate as a possible enumeration attempt.`,
    });
  }

  const quota = countByWorkspace(events, "QUOTA_EXCEEDED", now, QUOTA_WINDOW_MS);
  for (const [workspaceId, count] of [...quota.entries()].sort()) {
    if (count >= QUOTA_BURST_CRITICAL) {
      alarms.push({
        rule: "quota-burst",
        level: "critical",
        detail: `Workspace ${workspaceId} exhausted quota ${count} times in 10 minutes; review rate limits and rotate credentials.`,
      });
    } else if (count >= QUOTA_BURST_ELEVATED) {
      alarms.push({
        rule: "quota-burst",
        level: "elevated",
        detail: `Workspace ${workspaceId} exhausted quota ${count} times in 10 minutes; review rate limits.`,
      });
    }
  }

  const limited = countInWindow(events, "RATE_LIMITED", now, RATE_WINDOW_MS);
  if (limited >= RATE_SUSTAINED_ELEVATED) {
    alarms.push({
      rule: "rate-sustained",
      level: "elevated",
      detail: `${limited} rate denials in 1 minute; review gateway limits.`,
    });
  }

  if (stuckJobs >= STUCK_JOBS_ELEVATED) {
    alarms.push({
      rule: "stuck-jobs",
      level: "elevated",
      detail: `${stuckJobs} jobs past their time budget; cancel, inspect worker logs, re-verify the no-model gate.`,
    });
  }

  const level: AlarmLevel = alarms.some((alarm) => alarm.level === "critical")
    ? "critical"
    : alarms.length > 0
      ? "elevated"
      : "ok";
  return {
    level,
    alarms,
    recommendedAction:
      level === "critical"
        ? "Treat as an incident: attribute to identity and workspace, preserve redacted logs, revoke suspect credentials, cancel running jobs."
        : level === "elevated"
          ? "Investigate before the next release: attribute the workspace, review limits, rotate credentials if indicated."
          : "No action required.",
  };
}
