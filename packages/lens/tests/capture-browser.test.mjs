import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright-core";
import { renderOfflineSource } from "../src/capture-child.ts";

test("Chromium capture remains offline, script-free, and honest about missing resources", async () => {
  const fixture = {
    href: "https://example.org/catalog",
    html: `<!doctype html><html><head>
      <title>Evidence Fixture</title>
      <link rel="stylesheet" href="https://example.org/not-loaded.css">
      <script>document.title = "UNSAFE SCRIPT RAN"</script>
      </head><body><header>Navigation</header>
      <main><section><h1>Observed heading</h1><p>Observed text</p>
      <img src="/never-fetched.png" alt="asset"></section></main></body></html>`,
    sha256: "a".repeat(64),
    byteCount: 350,
    redirects: 0,
  };
  const result = await renderOfflineSource(fixture, chromium.executablePath());
  assert.equal(result.kind, "result");
  assert.equal(result.status, "partial");
  assert.equal(result.title, "Evidence Fixture");
  assert.equal(result.sourceUrl, fixture.href);
  assert.equal(result.sections.some((part) => part.text.includes("Observed heading")), true);
  assert.deepEqual(result.assets, [{
    tag: "img", href: "https://example.org/never-fetched.png",
  }]);
  assert.deepEqual(result.coverageGaps, [
    "javascript-disabled", "external-resources-blocked", "viewport-only-screenshot",
  ]);
  const image = Buffer.from(result.screenshotBase64, "base64");
  assert.ok(image.length > 500 && image.length <= 2_000_000);
  assert.equal(image.subarray(0, 2).toString("hex"), "ffd8");
});
