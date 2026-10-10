import assert from "node:assert/strict";
import test from "node:test";

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
  const result = await renderOfflineSource(fixture);
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

test("isolated child can launch the pinned headless browser without inheriting HOME", async () => {
  const { fork } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { isolatedWorkerEnv } = await import("../src/capture-worker.ts");

  const home = mkdtempSync(join(tmpdir(), "skelet-child-browser-"));
  const probe = join(home, "browser-probe.mjs");
  try {
    const moduleUrl = new URL("../node_modules/playwright-core/index.mjs", import.meta.url).href;
    writeFileSync(probe, [
      `import { chromium } from ${JSON.stringify(moduleUrl)};`,
      "const browser = await chromium.launch({ headless: true });",
      "await browser.close();",
      "process.send?.({ started: true, home: process.env.HOME, secret: process.env.GITHUB_TOKEN });",
    ].join("\n"));
    const result = await new Promise((resolve, reject) => {
      const child = fork(probe, [], {
        env: isolatedWorkerEnv(home), stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      const deadline = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Isolated Chromium probe deadline exceeded"));
      }, 12_000);
      child.once("message", (message) => {
        clearTimeout(deadline);
        resolve(message);
      });
      child.once("error", (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(deadline);
        reject(new Error(`Isolated Chromium probe exited ${code}`));
      });
    });
    assert.equal(result.started, true);
    assert.equal(result.home, home);
    assert.equal(Object.hasOwn(result, "secret"), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
