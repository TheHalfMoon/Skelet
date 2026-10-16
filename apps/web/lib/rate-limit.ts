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
/**
 * Bound on distinct rate-limit keys held in memory. The limiter is a
 * best-effort single-instance guard; without a bound, abandoned keys
 * (rotating IPs, rotated credentials) accumulate for the life of the
 * server process. Eviction below prefers fully-stale keys and falls back
 * to oldest-inserted order, so active callers are never dropped first.
 */
const MAX_KEYS = 5000;

const windows = new Map<string, number[]>();

function evictKeys(at: number): void {
  for (const [storedKey, stamps] of windows) {
    const newest = stamps.length === 0 ? 0 : (stamps[stamps.length - 1] ?? 0);
    if (newest <= at - WINDOW_MS) windows.delete(storedKey);
  }
  if (windows.size >= MAX_KEYS) {
    const excess = windows.size - MAX_KEYS + 1;
    let removed = 0;
    for (const storedKey of windows.keys()) {
      windows.delete(storedKey);
      removed += 1;
      if (removed >= excess) break;
    }
  }
}

export function checkRateLimit(key: string, now?: number): RateLimitResult {
  const at = now ?? Date.now();
  if (!windows.has(key) && windows.size >= MAX_KEYS) evictKeys(at);
  const seen = windows.get(key) ?? [];
  const fresh = seen.filter((stamp) => stamp > at - WINDOW_MS);
  if (fresh.length >= MAX_REQUESTS) {
    const oldest = fresh[0] ?? at;
    windows.set(key, fresh);
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

/** Observability hook for tests and operators: distinct keys held. */
export function rateLimitKeyCount(): number {
  return windows.size;
}

export const RATE_LIMIT_MAX_REQUESTS = MAX_REQUESTS;
export const RATE_LIMIT_WINDOW_MS = WINDOW_MS;
export const RATE_LIMIT_MAX_KEYS = MAX_KEYS;
