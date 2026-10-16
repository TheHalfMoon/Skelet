import assert from "node:assert/strict";
import test from "node:test";

import { renderOfflineSource } from "../src/capture-child.ts";
import { inspectJpeg } from "../src/jpeg-evidence.ts";

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
  assert.equal(result.viewport, "desktop");
  const dimensions = inspectJpeg(image);
  assert.ok(dimensions !== null);
  assert.equal(dimensions.width, 1280);
  assert.equal(dimensions.height, 720);
});

test("mobile viewport reaches the isolated worker with its intended dimensions", async () => {
  const fixture = {
    href: "https://example.org/catalog",
    html: `<!doctype html><html><head><title>Mobile Fixture</title></head><body><main><section><p>Observed</p></section></main></body></html>`,
    sha256: "b".repeat(64),
    byteCount: 200,
    redirects: 0,
  };
  const result = await renderOfflineSource(fixture, "mobile");
  assert.equal(result.viewport, "mobile");
  assert.deepEqual(result.coverageGaps, [
    "javascript-disabled", "external-resources-blocked", "viewport-only-screenshot",
  ]);
  const image = Buffer.from(result.screenshotBase64, "base64");
  const dimensions = inspectJpeg(image);
  assert.ok(dimensions !== null);
  assert.equal(dimensions.width, 390);
  assert.equal(dimensions.height, 844);
});

test("unsupported viewport fails closed without launching a browser", async () => {
  const fixture = {
    href: "https://example.org/catalog",
    html: `<!doctype html><html><head><title>Bad</title></head><body></body></html>`,
    sha256: "c".repeat(64),
    byteCount: 100,
    redirects: 0,
  };
  await assert.rejects(
    renderOfflineSource(fixture, "watch"),
    (error) => error.code === "capture/blocked",
  );
});

test("capture entrypoint validates the viewport before forking", async () => {
  const { capturePublicPage } = await import("../src/capture-worker.ts");
  await assert.rejects(
    capturePublicPage("https://example.org/", { viewport: "watch" }),
    (error) => error.code === "capture/blocked",
  );
});

test("journey service passes the requested viewport to the capture stage", async () => {
  const { analyzePublicUrl } = await import("../src/analyze-url.ts");
  let seenViewport;
  const stub = async (url, viewport) => {
    seenViewport = viewport;
    const rendered = await renderOfflineSource({
      href: "https://example.org/journey",
      html: `<!doctype html><html><head><title>Journey</title></head><body><main><section><p>Observed</p></section></main></body></html>`,
      sha256: "3".repeat(64),
      byteCount: 200,
      redirects: 0,
    }, viewport ?? "desktop");
    const { readFileSync } = await import("node:fs");
    const jpeg = readFileSync(new URL("./fixtures/valid.jpeg", import.meta.url)).toString("base64");
    return { ...rendered, screenshotBase64: jpeg };
  };
  const desktop = await analyzePublicUrl("https://example.org/journey", { capture: stub }, { viewport: "desktop" });
  assert.equal(seenViewport, "desktop");
  assert.equal(desktop.report.status, "partial");
  const mobile = await analyzePublicUrl("https://example.org/journey", { capture: stub }, { viewport: "mobile" });
  assert.equal(seenViewport, "mobile");
  assert.equal(mobile.report.status, "partial");
  await assert.rejects(
    analyzePublicUrl("https://example.org/journey", { capture: stub }, { viewport: "watch" }),
    (error) => error.code === "lens/invalid-url",
  );
});

test("isolated child can launch the pinned headless browser without inheriting HOME", async () => {
  const { fork } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { isolatedWorkerEnv } = await import("../src/capture-worker.ts");

  const home = mkdtempSync(join(tmpdir(), "skilit-child-browser-"));
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
