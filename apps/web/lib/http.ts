import { createHash } from "node:crypto";

/**
 * Shared HTTP helpers for versioned API routes: client keying for rate
 * limits and fail-closed envelopes. Rate keys bind to the presented
 * credential hash once known, so rotating forwarding headers alone does
 * not mint fresh buckets; unauthenticated callers share a conservative
 * fallback bucket. Deployments behind a trusted proxy should prefer the
 * platform-provided client IP over forwarding headers.
 */

export function clientKey(request: Request, token: string | null): string {
  if (token !== null) {
    const digest = createHash("sha256").update(token, "utf8").digest("hex").slice(0, 32);
    return `credential:${digest}`;
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return `anonymous:${forwarded.split(",")[0]?.trim() || "unknown"}`;
  }
  return "anonymous:unknown";
}
