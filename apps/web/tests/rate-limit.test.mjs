import test from "node:test";
import assert from "node:assert/strict";

import {
  checkRateLimit,
  resetRateLimits,
  rateLimitKeyCount,
  RATE_LIMIT_MAX_KEYS,
  RATE_LIMIT_MAX_REQUESTS,
} from "../lib/rate-limit.ts";

test("rate limiter still fails closed at the window edge", () => {
  resetRateLimits();
  try {
    const at = 1_700_000_000_000;
    for (let index = 0; index < RATE_LIMIT_MAX_REQUESTS; index += 1) {
      assert.equal(checkRateLimit("edge-client", at + index).allowed, true);
    }
    const denied = checkRateLimit("edge-client", at + RATE_LIMIT_MAX_REQUESTS);
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfterSeconds >= 1);
    assert.equal(checkRateLimit("edge-other", at + RATE_LIMIT_MAX_REQUESTS).allowed, true);
  } finally {
    resetRateLimits();
  }
});

test("denied requests prune stale entries instead of leaking them", () => {
  resetRateLimits();
  try {
    const at = 1_700_000_000_000;
    for (let index = 0; index < RATE_LIMIT_MAX_REQUESTS; index += 1) {
      checkRateLimit("prune-client", at + index);
    }
    checkRateLimit("prune-client", at + RATE_LIMIT_MAX_REQUESTS);
    // After the window passes, the stored bucket must recover.
    const after = checkRateLimit("prune-client", at + 120_000);
    assert.equal(after.allowed, true);
  } finally {
    resetRateLimits();
  }
});

test("abandoned keys are evicted so the key set stays bounded", () => {
  resetRateLimits();
  try {
    const at = 1_700_000_000_000;
    for (let index = 0; index < RATE_LIMIT_MAX_KEYS + 500; index += 1) {
      checkRateLimit(`abandoned-${index}`, at);
    }
    // Fully-stale sweep on the next new key keeps the map at the bound.
    checkRateLimit("fresh-after-flood", at + 120_000);
    assert.ok(
      rateLimitKeyCount() <= RATE_LIMIT_MAX_KEYS,
      `expected bounded keys, saw ${rateLimitKeyCount()}`,
    );
    assert.equal(checkRateLimit("fresh-after-flood", at + 120_001).allowed, true);
  } finally {
    resetRateLimits();
  }
});
