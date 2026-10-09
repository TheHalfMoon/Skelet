import { createHmac, timingSafeEqual } from "node:crypto";
import type { DbClient, DbTransaction } from "./db.ts";
import { AuthError } from "./auth.ts";

/**
 * G04-04 billing boundary: capability plan model plus signature-verified,
 * replay-safe billing-event intake. Prices, provider credentials, and any
 * charge execution stay outside this module: plans are keys, Stripe is a
 * webhook payload shape, and the only network-adjacent input is a raw
 * body string the caller already received. Invoice/charge execution and
 * HTTP wiring land in later grains behind explicit configuration.
 */

export type PlanKey = "free" | "pro" | "team";
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "incomplete";

export interface PlanCapabilities {
  plan: PlanKey;
  maxWorkspaces: number;
  maxCollectionsPerWorkspace: number;
  includedSeats: number;
  lensJobsPerMonth: number;
  storageBytes: number;
  agentWrites: boolean;
}

/**
 * Capability matrix only. No prices live in code: production prices
 * remain configuration in the deploying environment.
 */
const PLANS: Record<PlanKey, PlanCapabilities> = {
  free: {
    plan: "free",
    maxWorkspaces: 1,
    maxCollectionsPerWorkspace: 5,
    includedSeats: 1,
    lensJobsPerMonth: 10,
    storageBytes: 500 * 1024 * 1024,
    agentWrites: false,
  },
  pro: {
    plan: "pro",
    maxWorkspaces: 5,
    maxCollectionsPerWorkspace: 50,
    includedSeats: 5,
    lensJobsPerMonth: 500,
    storageBytes: 20 * 1024 * 1024 * 1024,
    agentWrites: true,
  },
  team: {
    plan: "team",
    maxWorkspaces: 25,
    maxCollectionsPerWorkspace: 500,
    includedSeats: 25,
    lensJobsPerMonth: 5000,
    storageBytes: 200 * 1024 * 1024 * 1024,
    agentWrites: true,
  },
};

export function capabilitiesFor(plan: string): PlanCapabilities {
  const found = (PLANS as Record<string, PlanCapabilities>)[plan];
  if (found === undefined) {
    throw new AuthError("auth/invalid-plan", "Plan is unknown.");
  }
  return { ...found };
}

export interface Subscription {
  workspaceId: string;
  planKey: PlanKey;
  status: SubscriptionStatus;
  seats: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

function toIsoTimestamp(raw: unknown): string {
  const value = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(value.getTime())) {
    throw new Error("Invalid billing timestamp");
  }
  return value.toISOString();
}

function toPlanKey(value: unknown): PlanKey {
  if (value !== "free" && value !== "pro" && value !== "team") {
    throw new Error("Invalid plan key in database");
  }
  return value;
}

function toStatus(value: unknown): SubscriptionStatus {
  if (
    value !== "active" &&
    value !== "past_due" &&
    value !== "canceled" &&
    value !== "incomplete"
  ) {
    throw new Error("Invalid subscription status in database");
  }
  return value;
}

function toSubscription(row: Record<string, unknown>): Subscription {
  return {
    workspaceId: String(row.workspace_id),
    planKey: toPlanKey(row.plan_key),
    status: toStatus(row.status),
    seats: Number(row.seats),
    stripeCustomerId: row.stripe_customer_id === null ? null : String(row.stripe_customer_id),
    stripeSubscriptionId:
      row.stripe_subscription_id === null ? null : String(row.stripe_subscription_id),
    currentPeriodEnd:
      row.current_period_end === null ? null : toIsoTimestamp(row.current_period_end),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

function requireRow(rows: Record<string, unknown>[]): Record<string, unknown> {
  const row = rows[0];
  if (!row) throw new Error("Database operation returned no row");
  return row;
}

function validatePlanKey(plan: string): PlanKey {
  if (plan !== "free" && plan !== "pro" && plan !== "team") {
    throw new AuthError("auth/invalid-plan", "Plan is unknown.");
  }
  return plan;
}

function validateStatus(status: string): SubscriptionStatus {
  if (
    status !== "active" &&
    status !== "past_due" &&
    status !== "canceled" &&
    status !== "incomplete"
  ) {
    throw new AuthError("auth/invalid-subscription", "Subscription status is invalid.");
  }
  return status;
}

export async function getSubscription(
  tx: DbTransaction,
  workspaceId: string,
): Promise<Subscription | null> {
  const result = await tx.query(
    `select workspace_id, plan_key, status, seats, stripe_customer_id,
            stripe_subscription_id, current_period_end, created_at, updated_at
     from subscriptions where workspace_id = $1`,
    [workspaceId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toSubscription(row);
}

/**
 * Server-side provisioning only: create or replace a workspace
 * subscription. Never callable with client-supplied plan fields as
 * authority; plan changes arrive via verified billing events.
 */
export async function setSubscription(
  client: DbClient,
  input: {
    workspaceId: string;
    planKey: PlanKey;
    status?: SubscriptionStatus;
    seats?: number;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    currentPeriodEnd?: string | null;
  },
): Promise<Subscription> {
  const planKey = validatePlanKey(input.planKey);
  const status = input.status === undefined ? "active" : validateStatus(input.status);
  const seats = input.seats ?? 1;
  if (!Number.isInteger(seats) || seats < 1) {
    throw new AuthError("auth/invalid-subscription", "Seat count is invalid.");
  }
  return client.transaction(async (tx) => {
    const workspace = await tx.query("select id from workspaces where id = $1", [
      input.workspaceId,
    ]);
    if (workspace.rows.length === 0) {
      throw new AuthError("auth/workspace-not-found", "Workspace was not found.");
    }
    const saved = await tx.query(
      `insert into subscriptions
         (workspace_id, plan_key, status, seats, stripe_customer_id,
          stripe_subscription_id, current_period_end)
       values ($1, $2, $3, $4, $5, $6, $7::timestamptz)
       on conflict (workspace_id) do update set
         plan_key = excluded.plan_key, status = excluded.status,
         seats = excluded.seats, stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         current_period_end = excluded.current_period_end
       returning workspace_id, plan_key, status, seats, stripe_customer_id,
         stripe_subscription_id, current_period_end, created_at, updated_at`,
      [
        input.workspaceId,
        planKey,
        status,
        seats,
        input.stripeCustomerId ?? null,
        input.stripeSubscriptionId ?? null,
        input.currentPeriodEnd ?? null,
      ],
    );
    return toSubscription(requireRow(saved.rows));
  });
}

export class WebhookError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WebhookError";
    this.code = code;
  }
}

const WEBHOOK_TOLERANCE_SECONDS = 300;

interface ParsedSignature {
  timestamp: number;
  signatures: string[];
}

/** Parse a Stripe-style `t=...,v1=...` signature header. */
function parseSignatureHeader(header: string): ParsedSignature {
  if (typeof header !== "string" || header.length === 0) {
    throw new WebhookError("billing/invalid-signature", "Webhook signature is invalid.");
  }
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("=");
    if (key === "t") {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) timestamp = parsed;
    } else if (key === "v1" && /^[0-9a-f]+$/i.test(value)) {
      signatures.push(value.toLowerCase());
    }
  }
  if (timestamp === null || signatures.length === 0) {
    throw new WebhookError("billing/invalid-signature", "Webhook signature is invalid.");
  }
  return { timestamp, signatures };
}

/**
 * Verify a Stripe-style webhook signature over the exact raw body.
 * Fail-closed on malformed headers, unknown schemes, mismatched
 * signatures, and timestamps outside the tolerance window.
 */
export function verifyWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string;
  secret: string;
  toleranceSeconds?: number;
  now?: Date;
}): { eventTimestamp: string } {
  const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (typeof input.secret !== "string" || input.secret.length === 0) {
    throw new WebhookError("billing/not-configured", "Billing provider is not configured.");
  }
  const parsed = parseSignatureHeader(input.signatureHeader);
  const at = input.now ?? new Date();
  const ageSeconds = at.getTime() / 1000 - parsed.timestamp;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > tolerance) {
    throw new WebhookError("billing/invalid-signature", "Webhook signature is invalid.");
  }
  const expected = createHmac("sha256", input.secret)
    .update(`${parsed.timestamp}.${input.rawBody}`, "utf8")
    .digest("hex");
  const matched = parsed.signatures.some((candidate) => {
    const a = Buffer.from(candidate, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!matched) {
    throw new WebhookError("billing/invalid-signature", "Webhook signature is invalid.");
  }
  return { eventTimestamp: new Date(parsed.timestamp * 1000).toISOString() };
}

export interface BillingEventResult {
  eventId: string;
  applied: boolean;
}

/**
 * Idempotent billing-event intake. The first delivery records the event
 * and runs apply() in the same transaction; replays hit the unique
 * event_id, skip apply(), and report applied:false. Apply failures roll
 * back the intake row too, so a failed event can be redelivered.
 */
export async function handleBillingEvent(
  client: DbClient,
  input: {
    provider?: string;
    eventId: string;
    eventType: string;
    payload?: Record<string, unknown>;
    apply: (tx: DbTransaction) => Promise<void>;
  },
): Promise<BillingEventResult> {
  if (typeof input.eventId !== "string" || input.eventId.trim().length === 0) {
    throw new WebhookError("billing/invalid-event", "Billing event is invalid.");
  }
  if (typeof input.eventType !== "string" || input.eventType.trim().length === 0) {
    throw new WebhookError("billing/invalid-event", "Billing event is invalid.");
  }
  const provider = input.provider ?? "stripe";
  if (provider !== "stripe") {
    throw new WebhookError("billing/invalid-event", "Billing provider is unsupported.");
  }
  return client.transaction(async (tx) => {
    const recorded = await tx.query(
      `insert into billing_events (provider, event_id, event_type, payload)
       values ($1, $2, $3, $4::jsonb) on conflict (event_id) do nothing
       returning id`,
      [provider, input.eventId, input.eventType, JSON.stringify(input.payload ?? {})],
    );
    if (recorded.rows.length === 0) {
      return { eventId: input.eventId, applied: false };
    }
    await input.apply(tx);
    await tx.query("update billing_events set applied_at = now() where event_id = $1", [
      input.eventId,
    ]);
    return { eventId: input.eventId, applied: true };
  });
}
