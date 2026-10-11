import assert from "node:assert/strict";
import test from "node:test";

import {
  CaptureScopeError,
  resolveCaptureScope,
} from "../src/capture-scope.ts";

function scope(overrides = {}) {
  return {
    sourceUrl: "https://example.org/",
    mode: "single-page",
    maxPages: 3,
    maxDepth: 1,
    maxBytes: 3000000,
    timeBudgetMs: 120000,
    ...overrides,
  };
}

test("single-page resolves the source with an even budget split", () => {
  const inventory = resolveCaptureScope(scope());
  assert.equal(inventory.mode, "single-page");
  assert.equal(inventory.pages.length, 1);
  assert.equal(inventory.pages[0]?.url, "https://example.org/");
  assert.match(inventory.pages[0]?.urlSha256 ?? "", /^[0-9a-f]{64}$/);
  assert.match(inventory.scopeHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(inventory.pages[0]?.viewports, ["desktop"]);
  assert.equal(inventory.pages[0]?.budgetBytes, 3000000);
  assert.equal(inventory.pages[0]?.budgetMs, 120000);
  assert.deepEqual(inventory.excluded, []);
});

test("single-page rejects a divergent page list", () => {
  assert.throws(
    () =>
      resolveCaptureScope(
        scope({ pages: ["https://example.org/a", "https://example.org/b"] }),
      ),
    (error) => error instanceof CaptureScopeError && error.code === "scope/invalid-request",
  );
  const same = resolveCaptureScope(scope({ pages: ["https://example.org/"] }));
  assert.equal(same.pages.length, 1);
});

test("selected-pages keeps request order and records gaps", () => {
  const inventory = resolveCaptureScope(
    scope({
      mode: "selected-pages",
      maxPages: 2,
      pages: [
        "https://example.org/b",
        "https://example.org/a",
        "https://example.org/b",
        "https://other.org/c",
        "https://example.org/c",
      ],
    }),
  );
  assert.deepEqual(
    inventory.pages.map((page) => page.url),
    ["https://example.org/b", "https://example.org/a"],
  );
  assert.deepEqual(
    inventory.excluded.map((gap) => [gap.reason, gap.url]),
    [
      ["duplicate", "https://example.org/b"],
      ["cross-site", "https://other.org/c"],
      ["over-budget", "https://example.org/c"],
    ],
  );
  assert.equal(inventory.pages[0]?.budgetBytes, 1500000);
});

test("bounded-sitemap orders lexicographically and slices the budget", () => {
  const inventory = resolveCaptureScope(
    scope({
      mode: "bounded-sitemap",
      maxPages: 2,
      pages: [
        "https://example.org/z",
        "https://example.org/m",
        "https://example.org/a",
      ],
    }),
  );
  assert.deepEqual(
    inventory.pages.map((page) => page.url),
    ["https://example.org/a", "https://example.org/m"],
  );
  assert.deepEqual(
    inventory.excluded.map((gap) => gap.reason),
    ["over-budget"],
  );
});

test("rejected URLs fail closed and never enter the inventory", () => {
  assert.throws(
    () =>
      resolveCaptureScope(
        scope({
          mode: "selected-pages",
          pages: ["http://example.org/plain", "file:///etc/passwd"],
        }),
      ),
    (error) => error instanceof CaptureScopeError,
  );
  const inventory = resolveCaptureScope(
    scope({
      mode: "selected-pages",
      pages: ["https://example.org/ok", "http://example.org/plain"],
    }),
  );
  assert.equal(inventory.pages.length, 1);
  assert.equal(inventory.excluded[0]?.reason, "rejected-url");
});

test("scope hash is deterministic for identical scopes", () => {
  const left = resolveCaptureScope(
    scope({
      mode: "bounded-sitemap",
      viewports: ["mobile", "desktop"],
      pages: ["https://example.org/b", "https://example.org/a"],
    }),
  );
  const right = resolveCaptureScope(
    scope({
      mode: "bounded-sitemap",
      viewports: ["desktop", "mobile"],
      pages: ["https://example.org/b", "https://example.org/a"],
    }),
  );
  assert.equal(left.scopeHash, right.scopeHash);
  assert.deepEqual(left.viewports, ["desktop", "mobile"]);
  const other = resolveCaptureScope(
    scope({
      mode: "bounded-sitemap",
      pages: ["https://example.org/b", "https://example.org/a", "https://example.org/c"],
    }),
  );
  assert.notEqual(left.scopeHash, other.scopeHash);
});

test("malformed scopes fail closed", () => {
  const bad = [
    scope({ sourceUrl: "http://example.org/" }),
    scope({ mode: "crawl-everything" }),
    scope({ maxPages: 26 }),
    scope({ maxDepth: 4 }),
    scope({ maxBytes: 52428801 }),
    scope({ timeBudgetMs: 999 }),
    scope({ mode: "selected-pages" }),
    scope({ mode: "selected-pages", pages: [] }),
    scope({ viewports: [] }),
    scope({ viewports: ["watch"] }),
    scope({ pages: ["https://example.org/a"] }),
    { ...scope(), tenant: "intruder" },
  ];
  for (const candidate of bad) {
    assert.throws(
      () => resolveCaptureScope(candidate),
      (error) => error instanceof CaptureScopeError && error.code === "scope/invalid-request",
      JSON.stringify(candidate).slice(0, 80),
    );
  }
});
