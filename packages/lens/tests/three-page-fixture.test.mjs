import assert from "node:assert/strict";
import test from "node:test";

import { renderOfflineSource } from "../src/capture-child.ts";
import { inspectJpeg } from "../src/jpeg-evidence.ts";
import { resolveCaptureScope } from "../src/capture-scope.ts";
import { executeCaptureScope } from "../src/capture-traversal.ts";
import { assembleLensReportFromCapture } from "../src/report-assembly.ts";

// AF-05b: rights-cleared three-page deterministic fixture. Synthetic
// example.org pages only; no live network. Every screenshot is a real
// offline Chromium render (JS disabled, remote subresources blocked).
const PAGES = [
  {
    url: "https://example.org/",
    title: "Fixture Home",
    html: `<!doctype html><html><head><title>Fixture Home</title></head><body><header>Home nav</header><main><section><h1>Home heading</h1><p>Home paragraph</p></section></main><footer>Home footer</footer></body></html>`,
  },
  {
    url: "https://example.org/catalog",
    title: "Fixture Catalog",
    html: `<!doctype html><html><head><title>Fixture Catalog</title></head><body><main><section><h1>Catalog heading</h1><p>Catalog paragraph</p><img src="/catalog.png" alt="catalog"></section></main></body></html>`,
  },
  {
    url: "https://example.org/about",
    title: "Fixture About",
    html: `<!doctype html><html><head><title>Fixture About</title></head><body><main><article><h2>About heading</h2><p>About paragraph</p></article></main></body></html>`,
  },
];

function guarded(page, index) {
  return {
    href: page.url,
    html: page.html,
    sha256: String(index).repeat(64).slice(0, 64),
    byteCount: page.html.length,
    redirects: 0,
  };
}

test("three-page scope resolves deterministically with both viewports", () => {
  const first = resolveCaptureScope({
    sourceUrl: "https://example.org/",
    mode: "selected-pages",
    pages: PAGES.map((page) => page.url),
    maxPages: 3,
    maxDepth: 1,
    maxBytes: 3000000,
    timeBudgetMs: 120000,
    viewports: ["desktop", "mobile"],
  });
  const second = resolveCaptureScope({
    sourceUrl: "https://example.org/",
    mode: "selected-pages",
    pages: PAGES.map((page) => page.url),
    maxPages: 3,
    maxDepth: 1,
    maxBytes: 3000000,
    timeBudgetMs: 120000,
    viewports: ["mobile", "desktop"],
  });
  assert.equal(first.pages.length, 3);
  assert.deepEqual(first.pages.map((page) => page.url), PAGES.map((page) => page.url));
  assert.ok(first.pages.every((page) => JSON.stringify(page.viewports) === JSON.stringify(["desktop", "mobile"])));
  assert.equal(first.scopeHash, second.scopeHash);
  assert.deepEqual(first.excluded, []);
});

test("three-page traversal completes under budget with an offline stub", async () => {
  const inventory = resolveCaptureScope({
    sourceUrl: "https://example.org/",
    mode: "selected-pages",
    pages: PAGES.map((page) => page.url),
    maxPages: 3,
    maxDepth: 1,
    maxBytes: 3000000,
    timeBudgetMs: 120000,
    viewports: ["desktop", "mobile"],
  });
  const seen = [];
  const result = await executeCaptureScope(
    inventory,
    async (url, budgetBytes, budgetMs) => {
      seen.push({ url, budgetBytes, budgetMs });
      const page = PAGES.find((entry) => entry.url === url);
      assert.ok(page);
      return { htmlSha256: "ab".repeat(32), byteCount: page.html.length, redirects: 0 };
    },
    () => 1000,
  );
  assert.equal(result.outcome, "completed");
  assert.equal(result.captured, 3);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.pages.map((page) => page.url), PAGES.map((page) => page.url));
});

test("three-page fixture captures desktop and mobile with bound evidence", async () => {
  const analysisIds = new Set();
  for (const [index, page] of PAGES.entries()) {
    for (const viewport of ["desktop", "mobile"]) {
      const rendered = await renderOfflineSource(guarded(page, index), viewport);
      assert.equal(rendered.viewport, viewport);
      assert.equal(rendered.sourceUrl, page.url);
      assert.equal(rendered.title, page.title);
      assert.deepEqual(rendered.coverageGaps, [
        "javascript-disabled",
        "external-resources-blocked",
        "viewport-only-screenshot",
      ]);
      const image = Buffer.from(rendered.screenshotBase64, "base64");
      assert.equal(image.subarray(0, 2).toString("hex"), "ffd8");
      const dimensions = inspectJpeg(image);
      assert.ok(dimensions !== null);
      if (viewport === "desktop") {
        assert.equal(dimensions.width, 1280);
        assert.equal(dimensions.height, 720);
      } else {
        assert.equal(dimensions.width, 390);
        assert.equal(dimensions.height, 844);
      }
      const report = assembleLensReportFromCapture(rendered);
      assert.equal(report.status, "partial");
      assert.equal(report.observed.title, page.title);
      assert.match(report.analysisId, /^[0-9a-f]{64}$/);
      assert.ok(report.observed.assets.every((asset) => asset.rights === "unknown" && asset.downloadable === false));
      assert.ok(report.provenance.coverageGaps.includes("javascript-disabled"));
      analysisIds.add(report.analysisId);
    }
  }
  // 3 pages x 2 viewports produce 6 distinct reports because screenshots differ.
  assert.equal(analysisIds.size, 6);
}, { timeout: 60000 });
