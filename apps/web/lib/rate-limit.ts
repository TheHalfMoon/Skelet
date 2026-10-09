/**
 * Minimal in-process rate limiter for the MCP route: a sliding window of
 * request timestamps per key (client IP). Best-effort under
 * multi-instance deployments; the deploying gateway owns authoritative
 * enforcement. Fails closed when the window is full.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;

const windows = new Map<string, number[]>();

export function checkRateLimit(key: string, now?: number): RateLimitResult {
  const at = now ?? Date.now();
  const seen = windows.get(key) ?? [];
  const fresh = seen.filter((stamp) => stamp > at - WINDOW_MS);
  if (fresh.length >= MAX_REQUESTS) {
    const oldest = fresh[0] ?? at;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + WINDOW_MS - at) / 1000)),
    };
  }
  fresh.push(at);
  windows.set(key, fresh);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test and lifecycle hook: drop all recorded windows. */
export function resetRateLimits(): void {
  windows.clear();
}

export const RATE_LIMIT_MAX_REQUESTS = MAX_REQUESTS;
export const RATE_LIMIT_WINDOW_MS = WINDOW_MS;
