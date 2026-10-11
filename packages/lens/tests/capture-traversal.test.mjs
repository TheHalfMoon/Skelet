import assert from "node:assert/strict";
import test from "node:test";

import { resolveCaptureScope } from "../src/capture-scope.ts";
import {
  CaptureTraversalError,
  executeCaptureScope,
} from "../src/capture-traversal.ts";

const HEX = "ab".repeat(32);

function inventory(overrides = {}) {
  return resolveCaptureScope({
    sourceUrl: "https://example.org/",
    mode: "selected-pages",
    pages: [
      "https://example.org/a",
      "https://example.org/b",
      "https://example.org/c",
    ],
    maxPages: 3,
    maxDepth: 1,
    maxBytes: 3000000,
    timeBudgetMs: 120000,
    ...overrides,
  });
}

function okFetch(seen = []) {
  return async (url, budgetBytes, budgetMs) => {
    seen.push({ url, budgetBytes, budgetMs });
    return { htmlSha256: HEX, byteCount: 1200, redirects: 0 };
  };
}

function typedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

test("all pages captured in inventory order reports completed", async () => {
  const seen = [];
  const result = await executeCaptureScope(inventory(), okFetch(seen), () => 1000);
  assert.equal(result.outcome, "completed");
  assert.equal(result.attempted, 3);
  assert.equal(result.captured, 3);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.bytesTotal, 3600);
  assert.deepEqual(result.pages.map((page) => page.url), [
    "https://example.org/a",
    "https://example.org/b",
    "https://example.org/c",
  ]);
  assert.ok(result.pages.every((page) => page.status === "captured"));
  assert.ok(result.pages.every((page) => page.htmlSha256 === HEX));
});

test("one typed fetch failure reports partial and preserves the code", async () => {
  const fetchPage = async (url) => {
    if (url.endsWith("/b")) throw typedError("capture/timeout", "Download timed out.");
    return { htmlSha256: HEX, byteCount: 900, redirects: 1 };
  };
  const result = await executeCaptureScope(inventory(), fetchPage, () => 500);
  assert.equal(result.outcome, "partial");
  assert.equal(result.captured, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.pages[1]?.status, "failed");
  assert.equal(result.pages[1]?.code, "capture/timeout");
  assert.equal(result.pages[1]?.detail, "Download timed out.");
  assert.equal(result.bytesTotal, 1800);
});

test("every page failing reports failed with zero captures", async () => {
  const fetchPage = async () => {
    throw typedError("capture/blocked", "Redirect cycle detected.");
  };
  const result = await executeCaptureScope(inventory(), fetchPage, () => 0);
  assert.equal(result.outcome, "failed");
  assert.equal(result.attempted, 3);
  assert.equal(result.captured, 0);
  assert.equal(result.failed, 3);
  assert.equal(result.bytesTotal, 0);
});

test("per-page budget slices reach the fetch function", async () => {
  const seen = [];
  await executeCaptureScope(inventory(), okFetch(seen), () => 0);
  assert.equal(seen.length, 3);
  for (const call of seen) {
    assert.equal(call.budgetBytes, 1000000);
    assert.equal(call.budgetMs, 40000);
  }
});

test("byte budget exhaustion skips the remaining pages", async () => {
  const scope = inventory({ maxBytes: 2000 });
  const result = await executeCaptureScope(scope, okFetch(), () => 0);
  assert.equal(result.outcome, "partial");
  assert.equal(result.captured, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.pages[2]?.status, "skipped");
  assert.equal(result.pages[2]?.code, "capture/skipped");
});

test("time budget exhaustion skips pages not yet attempted", async () => {
  const scope = inventory();
  let clock = 0;
  const fetchPage = async () => {
    clock += 200000;
    return { htmlSha256: HEX, byteCount: 10, redirects: 0 };
  };
  const result = await executeCaptureScope(scope, fetchPage, () => clock);
  assert.equal(result.captured, 1);
  assert.equal(result.skipped, 2);
  assert.equal(result.outcome, "partial");
  assert.ok(result.pages.slice(1).every((page) => page.status === "skipped"));
});

test("untyped rejection maps to capture/network without fabrication", async () => {
  const fetchPage = async () => {
    throw new Error("socket hang up");
  };
  const result = await executeCaptureScope(inventory(), fetchPage, () => 0);
  assert.equal(result.outcome, "failed");
  assert.equal(result.pages[0]?.code, "capture/network");
  assert.equal(result.pages[0]?.detail, "Page fetch failed without a typed code.");
  assert.equal(result.pages[0]?.htmlSha256, undefined);
});

test("malformed fetch records fail the page instead of trusting it", async () => {
  const fetchPage = async () => ({ htmlSha256: "not-a-hash", byteCount: -4, redirects: 0 });
  const result = await executeCaptureScope(inventory(), fetchPage, () => 0);
  assert.equal(result.outcome, "failed");
  assert.equal(result.pages[0]?.status, "failed");
  assert.equal(result.pages[0]?.code, "capture/network");
});

test("malformed inventories fail closed", async () => {
  const bad = [null, {}, { scopeHash: "zz", pages: [], budgets: {} }, { scopeHash: HEX, pages: [], budgets: { maxPages: 3, maxDepth: 1, maxBytes: 9, timeBudgetMs: 9 } }];
  for (const candidate of bad) {
    await assert.rejects(executeCaptureScope(candidate, okFetch(), () => 0), CaptureTraversalError);
  }
  const tooMany = { ...inventory(), pages: Array.from({ length: 26 }, () => inventory().pages[0]) };
  await assert.rejects(executeCaptureScope(tooMany, okFetch(), () => 0), CaptureTraversalError);
  await assert.rejects(executeCaptureScope(inventory(), undefined, () => 0), CaptureTraversalError);
});

test("single-page scope executes exactly one attempt", async () => {
  const scope = resolveCaptureScope({
    sourceUrl: "https://example.org/",
    mode: "single-page",
    maxPages: 1,
    maxDepth: 0,
    maxBytes: 1000000,
    timeBudgetMs: 60000,
  });
  const seen = [];
  const result = await executeCaptureScope(scope, okFetch(seen), () => 42);
  assert.equal(result.outcome, "completed");
  assert.equal(result.attempted, 1);
  assert.deepEqual(seen.map((call) => call.url), ["https://example.org/"]);
});

test("over-slice capture is recorded honestly and the totals gate skips the rest", async () => {
  const scope = inventory({ maxBytes: 1500 });
  const fetchPage = async () => ({ htmlSha256: HEX, byteCount: 1200, redirects: 0 });
  const result = await executeCaptureScope(scope, fetchPage, () => 0);
  assert.equal(result.pages[0]?.status, "captured");
  assert.equal(result.pages[0]?.byteCount, 1200);
  assert.equal(result.captured, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.outcome, "partial");
  assert.ok(result.bytesTotal > 1500);
});

test("elapsed time is reported from the injectable clock", async () => {
  let clock = 1000;
  const fetchPage = async () => {
    clock += 250;
    return { htmlSha256: HEX, byteCount: 10, redirects: 0 };
  };
  const result = await executeCaptureScope(inventory(), fetchPage, () => clock);
  assert.equal(result.outcome, "completed");
  assert.equal(result.elapsedMs, 750);
});

test("typed failure detail is bounded at 500 characters", async () => {
  const fetchPage = async () => {
    throw typedError("capture/timeout", "x".repeat(900));
  };
  const result = await executeCaptureScope(inventory(), fetchPage, () => 0);
  assert.equal(result.pages[0]?.detail?.length, 500);
});
