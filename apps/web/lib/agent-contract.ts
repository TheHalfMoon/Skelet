/**
 * AF-03b canonical agent contract implementation (skilit.agent.v1).
 *
 * Single tested canonical envelope and error-policy module shared by MCP
 * and REST. Both transports return the same versioned envelope shape for
 * domain operations; transport status codes (HTTP statuses, JSON-RPC
 * codes) are derived from one mapping table so authorization, validation,
 * rights, pagination, partial, capability, and job semantics stay
 * consistent.
 *
 * Safety: all failure messages are static safe strings. No stack traces,
 * secrets, filesystem paths, database details, or existence oracles leave
 * this module. Unknown and denied objects share FORBIDDEN_OR_NOT_FOUND.
 */

import { randomUUID } from "node:crypto";

export const AGENT_SCHEMA_VERSION = "skilit.agent.v1" as const;

/** Legacy envelope version from before the Skilit rebrand; accepted on read. */
export const LEGACY_AGENT_SCHEMA_VERSION = "skelet.agent.v1" as const;

export type AgentErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN_OR_NOT_FOUND"
  | "NOT_AVAILABLE"
  | "RIGHTS_RESTRICTED"
  | "STALE_REVISION"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "PROVIDER_DISABLED"
  | "JOB_PENDING"
  | "JOB_FAILED"
  | "TIMEOUT"
  | "INTERNAL_OPAQUE";

export type AgentEvidenceMode =
  | "observed"
  | "deterministic-computation"
  | "heuristic-inference"
  | "generated-by-external-agent"
  | "unknown";

export interface AgentProvenance {
  evidence_mode: AgentEvidenceMode;
  source_uri?: string;
  captured_at?: string;
}

export interface AgentErrorBody {
  code: AgentErrorCode;
  message: string;
  retryable: boolean;
}

export interface AgentEnvelope {
  schema_version: typeof AGENT_SCHEMA_VERSION;
  request_id: string;
  status: "complete" | "partial";
  result: Record<string, unknown>;
  cursor?: string;
  warnings?: string[];
  error?: AgentErrorBody;
  provenance?: AgentProvenance;
}

interface ErrorMapping {
  httpStatus: number;
  mcpCode: number;
  retryable: boolean;
  message: string;
}

/**
 * Canonical mapping: one typed error code drives both transports.
 * MCP codes stay coarse (-32000 for domain failures) so the envelope
 * carries precision; HTTP statuses stay distinct where safe.
 */
export const AGENT_ERROR_CATALOG: Record<AgentErrorCode, ErrorMapping> = {
  INVALID_INPUT: { httpStatus: 400, mcpCode: -32602, retryable: false, message: "Request is invalid." },
  UNAUTHENTICATED: { httpStatus: 401, mcpCode: -32001, retryable: false, message: "Unauthorized." },
  FORBIDDEN_OR_NOT_FOUND: { httpStatus: 404, mcpCode: -32000, retryable: false, message: "Object was not found." },
  NOT_AVAILABLE: { httpStatus: 409, mcpCode: -32000, retryable: false, message: "Capability is not available." },
  RIGHTS_RESTRICTED: { httpStatus: 403, mcpCode: -32000, retryable: false, message: "Content is rights-restricted." },
  STALE_REVISION: { httpStatus: 409, mcpCode: -32000, retryable: false, message: "Revision is stale." },
  RATE_LIMITED: { httpStatus: 429, mcpCode: -32000, retryable: true, message: "Rate limited." },
  QUOTA_EXCEEDED: { httpStatus: 429, mcpCode: -32000, retryable: false, message: "Quota exceeded." },
  PROVIDER_DISABLED: { httpStatus: 503, mcpCode: -32000, retryable: false, message: "Provider is disabled." },
  JOB_PENDING: { httpStatus: 202, mcpCode: -32000, retryable: true, message: "Job is pending." },
  JOB_FAILED: { httpStatus: 500, mcpCode: -32000, retryable: false, message: "Job failed." },
  TIMEOUT: { httpStatus: 504, mcpCode: -32000, retryable: true, message: "Request timed out." },
  INTERNAL_OPAQUE: { httpStatus: 500, mcpCode: -32000, retryable: false, message: "Request failed." },
};

export const AGENT_URI_PATTERN =
  /^skilit:\/\/(product|version|artifact|flow|collection|lens|reference-pack)\/[A-Za-z0-9_-]{1,128}$/;

/** Legacy URI scheme from before the Skilit rebrand; accepted on read. */
export const LEGACY_AGENT_URI_PATTERN =
  /^skelet:\/\/(product|version|artifact|flow|collection|lens|reference-pack)\/[A-Za-z0-9_-]{1,128}$/;

/**
 * Normalize a persisted or client-supplied URI to the canonical skilit://
 * scheme. Canonical skilit:// values pass through; legacy skelet:// values
 * are upgraded. Anything else is returned unchanged for callers to reject.
 */
export function normalizeSkilitUri(uri: string): string {
  if (typeof uri !== "string") return uri;
  const trimmed = uri.trim();
  if (trimmed.toLowerCase().startsWith("skelet://")) {
    return `skilit://${trimmed.slice("skelet://".length)}`;
  }
  return trimmed;
}

/** True for canonical or legacy Skilit URIs (migration-readable). */
export function isSkilitUri(uri: unknown): boolean {
  if (typeof uri !== "string") return false;
  const trimmed = uri.trim();
  return AGENT_URI_PATTERN.test(trimmed) || LEGACY_AGENT_URI_PATTERN.test(trimmed);
}

export const REQUEST_ID_MAX = 128;
export const CURSOR_MAX = 256;
export const WARNINGS_MAX = 16;
export const WARNING_MAX_CHARS = 512;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

export class AgentContractError extends Error {
  readonly code: AgentErrorCode;
  readonly safeMessage: string;
  readonly retryable: boolean;
  readonly httpStatus: number;
  readonly mcpCode: number;
  readonly requestId: string;
  readonly warnings: string[];
  readonly cursor?: string | undefined;
  readonly provenance?: AgentProvenance | undefined;
  readonly partialResult: Record<string, unknown>;

  constructor(
    code: AgentErrorCode,
    options?: {
      message?: string | undefined;
      requestId?: string | undefined;
      warnings?: string[] | undefined;
      cursor?: string | undefined;
      provenance?: AgentProvenance | undefined;
      partialResult?: Record<string, unknown> | undefined;
    },
  ) {
    const mapping = AGENT_ERROR_CATALOG[code];
    // Only allow caller-provided messages for validation-class errors;
    // everything else uses the static safe catalog message so internals
    // can never leak. Validation messages are still bounded and callers
    // must pass pre-approved safe strings.
    const message =
      code === "INVALID_INPUT" && typeof options?.message === "string" && options.message.length > 0
        ? options.message.slice(0, 512)
        : mapping.message;
    super(message);
    this.name = "AgentContractError";
    this.code = code;
    this.safeMessage = message;
    this.retryable = mapping.retryable;
    this.httpStatus = mapping.httpStatus;
    this.mcpCode = mapping.mcpCode;
    this.requestId = sanitizeRequestId(options?.requestId) ?? randomUUID();
    this.warnings = sanitizeWarnings(options?.warnings);
    this.cursor = sanitizeCursor(options?.cursor);
    this.provenance = sanitizeProvenance(options?.provenance);
    this.partialResult = options?.partialResult ?? {};
  }

  toFailureEnvelope(): AgentEnvelope {
    const envelope: AgentEnvelope = {
      schema_version: AGENT_SCHEMA_VERSION,
      request_id: this.requestId,
      status: "complete",
      result: this.partialResult,
      error: { code: this.code, message: this.safeMessage, retryable: this.retryable },
    };
    if (this.cursor !== undefined) envelope.cursor = this.cursor;
    if (this.warnings.length > 0) envelope.warnings = this.warnings;
    if (this.provenance !== undefined) envelope.provenance = this.provenance;
    return envelope;
  }
}

export function sanitizeRequestId(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > REQUEST_ID_MAX) return undefined;
  // Reject control characters and newlines that could split logs.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  return trimmed;
}

export function newRequestId(provided?: unknown): string {
  return sanitizeRequestId(provided) ?? randomUUID();
}

function sanitizeWarnings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const entry of input) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0 || trimmed.length > WARNING_MAX_CHARS) continue;
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= WARNINGS_MAX) break;
  }
  return out;
}

function sanitizeCursor(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > CURSOR_MAX) return undefined;
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) return undefined;
  return trimmed;
}

function sanitizeProvenance(input: unknown): AgentProvenance | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const mode = record.evidence_mode;
  const allowed: AgentEvidenceMode[] = [
    "observed",
    "deterministic-computation",
    "heuristic-inference",
    "generated-by-external-agent",
    "unknown",
  ];
  if (typeof mode !== "string" || !allowed.includes(mode as AgentEvidenceMode)) return undefined;
  const out: AgentProvenance = { evidence_mode: mode as AgentEvidenceMode };
  if (typeof record.source_uri === "string" && record.source_uri.length > 0 && record.source_uri.length <= 2048) {
    out.source_uri = record.source_uri;
  }
  if (typeof record.captured_at === "string" && record.captured_at.length > 0 && record.captured_at.length <= 2048) {
    out.captured_at = record.captured_at;
  }
  return out;
}

export function successEnvelope(
  requestId: string,
  result: Record<string, unknown>,
  options?: {
    cursor?: string | undefined;
    warnings?: string[] | undefined;
    provenance?: AgentProvenance | undefined;
    partial?: boolean | undefined;
  },
): AgentEnvelope {
  const warnings = sanitizeWarnings(options?.warnings);
  const cursor = sanitizeCursor(options?.cursor);
  const provenance = sanitizeProvenance(options?.provenance);
  const envelope: AgentEnvelope = {
    schema_version: AGENT_SCHEMA_VERSION,
    request_id: requestId,
    status: options?.partial === true || warnings.length > 0 ? "partial" : "complete",
    result,
  };
  // Partial status requires a signal: warnings or cursor alone do not
  // force partial unless the caller asked. Warnings without partial still
  // return complete with warnings attached (validator allows both).
  if (options?.partial !== true && warnings.length > 0) {
    envelope.status = "complete";
  }
  if (cursor !== undefined) envelope.cursor = cursor;
  if (warnings.length > 0) envelope.warnings = warnings;
  if (provenance !== undefined) envelope.provenance = provenance;
  return envelope;
}

export function failureEnvelope(
  requestId: string,
  code: AgentErrorCode,
  options?: {
    message?: string | undefined;
    warnings?: string[] | undefined;
    cursor?: string | undefined;
    provenance?: AgentProvenance | undefined;
    partialResult?: Record<string, unknown> | undefined;
  },
): AgentEnvelope {
  const mapping = AGENT_ERROR_CATALOG[code];
  const message =
    code === "INVALID_INPUT" && typeof options?.message === "string" && options.message.length > 0
      ? options.message.slice(0, 512)
      : mapping.message;
  const envelope: AgentEnvelope = {
    schema_version: AGENT_SCHEMA_VERSION,
    request_id: requestId,
    status: "complete",
    result: options?.partialResult ?? {},
    error: { code, message, retryable: mapping.retryable },
  };
  const warnings = sanitizeWarnings(options?.warnings);
  const cursor = sanitizeCursor(options?.cursor);
  const provenance = sanitizeProvenance(options?.provenance);
  if (cursor !== undefined) envelope.cursor = cursor;
  if (warnings.length > 0) envelope.warnings = warnings;
  if (provenance !== undefined) envelope.provenance = provenance;
  return envelope;
}

export function httpStatusFor(code: AgentErrorCode): number {
  return AGENT_ERROR_CATALOG[code].httpStatus;
}

export function mcpCodeFor(code: AgentErrorCode): number {
  return AGENT_ERROR_CATALOG[code].mcpCode;
}

export function isAgentEnvelope(value: unknown): value is AgentEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    record.schema_version !== AGENT_SCHEMA_VERSION &&
    record.schema_version !== LEGACY_AGENT_SCHEMA_VERSION
  )
    return false;
  if (typeof record.request_id !== "string" || record.request_id.length === 0) return false;
  if (record.status !== "complete" && record.status !== "partial") return false;
  if (typeof record.result !== "object" || record.result === null || Array.isArray(record.result)) return false;
  if (record.error !== undefined) {
    if (typeof record.error !== "object" || record.error === null) return false;
    const error = record.error as Record<string, unknown>;
    if (typeof error.code !== "string" || !(error.code in AGENT_ERROR_CATALOG)) return false;
    if (typeof error.message !== "string" || error.message.length === 0) return false;
  }
  return true;
}

/** Opaque cursor: base64url(JSON {offset}). Malformed cursors throw INVALID_INPUT. */
export function encodeCursor(offset: number): string {
  const safe = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  return Buffer.from(JSON.stringify({ offset: safe }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: unknown): number {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > CURSOR_MAX) {
    throw new AgentContractError("INVALID_INPUT", { message: "Pagination cursor is invalid." });
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("bad cursor shape");
    }
    const offset = (parsed as { offset?: unknown }).offset;
    if (!Number.isInteger(offset) || (offset as number) < 0 || (offset as number) > 1_000_000) {
      throw new Error("bad offset");
    }
    return offset as number;
  } catch {
    throw new AgentContractError("INVALID_INPUT", { message: "Pagination cursor is invalid." });
  }
}

export function parseSearchLimit(raw: unknown): number {
  if (raw === undefined) return SEARCH_DEFAULT_LIMIT;
  const parsed = typeof raw === "string" ? Number(raw) : raw;
  if (!Number.isInteger(parsed) || (parsed as number) < 1 || (parsed as number) > SEARCH_MAX_LIMIT) {
    throw new AgentContractError("INVALID_INPUT", { message: "Pagination limit is invalid." });
  }
  return parsed as number;
}

/**
 * Capability gate for explicitly disabled operations. Reads
 * SKILIT_DISABLED_CAPABILITIES (comma-separated, e.g. "packs,registry").
 * Legacy SKELET_DISABLED_CAPABILITIES remains readable; SKILIT_* wins.
 * Unknown names are ignored. Empty means everything enabled.
 */
export function isCapabilityEnabled(capability: string): boolean {
  const raw =
    process.env.SKILIT_DISABLED_CAPABILITIES ??
    process.env.SKELET_DISABLED_CAPABILITIES;
  if (typeof raw !== "string" || raw.trim().length === 0) return true;
  const disabled = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return !disabled.includes(capability.trim().toLowerCase());
}

export function requireCapability(capability: string, requestId?: string): void {
  if (!isCapabilityEnabled(capability)) {
    throw new AgentContractError("PROVIDER_DISABLED", { requestId });
  }
}

/**
 * AF-03c capability advertisement. The two operator-gated capabilities are
 * packs (save_reference, create_reference_pack, collection get_object) and
 * registry (get_registry_item). Clients negotiate via initialize.skilit and
 * must handle PROVIDER_DISABLED with a REST or degraded fallback instead
 * of retrying the same disabled tool.
 */
export const SKILIT_CAPABILITIES = ["packs", "registry"] as const;
export type SkilitCapability = (typeof SKILIT_CAPABILITIES)[number];

export function describeCapabilities(): Record<SkilitCapability, boolean> {
  return { packs: isCapabilityEnabled("packs"), registry: isCapabilityEnabled("registry") };
}

export function isRetryableCode(code: AgentErrorCode): boolean {
  return AGENT_ERROR_CATALOG[code].retryable;
}

export const IDEMPOTENCY_KEY_MAX = 128;

/**
 * AF-03c idempotency keys: client-supplied opaque tokens (1..128 chars, no
 * control characters or whitespace) that let safe retries of write tools
 * return the same canonical state instead of duplicating it. Reads are
 * naturally idempotent; save_reference is idempotent via ON CONFLICT;
 * create_reference_pack deduplicates via the pack_idempotency ledger.
 */
export function sanitizeIdempotencyKey(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > IDEMPOTENCY_KEY_MAX) return undefined;
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) return undefined;
  return trimmed;
}

export function observedProvenance(sourceUri?: string): AgentProvenance {
  const out: AgentProvenance = { evidence_mode: "observed", captured_at: new Date().toISOString() };
  if (typeof sourceUri === "string" && sourceUri.length > 0 && sourceUri.length <= 2048) {
    out.source_uri = sourceUri;
  }
  return out;
}

export function computedProvenance(sourceUri?: string): AgentProvenance {
  const out: AgentProvenance = {
    evidence_mode: "deterministic-computation",
    captured_at: new Date().toISOString(),
  };
  if (typeof sourceUri === "string" && sourceUri.length > 0 && sourceUri.length <= 2048) {
    out.source_uri = sourceUri;
  }
  return out;
}
