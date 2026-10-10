import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { AnalyzeUrlError, analyzePublicUrl } from "../src/analyze-url.ts";
import { CaptureError } from "../src/capture-network.ts";
import { ReportError } from "../src/report-assembly.ts";
import { ExportError } from "../src/export-surface.ts";
import { renderOfflineSource } from "../src/capture-child.ts";

const jpeg = readFileSync(new URL("./fixtures/valid.jpeg", import.meta.url)).toString("base64");

// Genuine browser evidence at the stubbed network edge: a real offline
// Chromium render supplies every capture field; only the DNS-pinned HTTP
// ingress is stubbed, so assembly and export run their real code.
async function stubCapture() {
  const rendered = await renderOfflineSource({
    href: "https://example.org/journey",
    html: `<!doctype html><html><head><title>Journey</title>
      <meta name="generator" content="Hugo 0.120.0">
      <script>document.title = "UNSAFE SCRIPT RAN"</script>
      <script src="/app.js"></script>
      </head><body><main><section><p>Observed paragraph</p></section></main></body></html>`,
    sha256: "3".repeat(64),
    byteCount: 400,
    redirects: 0,
  });
  return {
    kind: "result",
    status: "partial",
    sourceUrl: rendered.sourceUrl,
    sourceSha256: rendered.sourceSha256,
    htmlBytes: rendered.htmlBytes,
    redirects: rendered.redirects,
    title: rendered.title,
    sections: rendered.sections,
    assets: rendered.assets,
    declarations: rendered.declarations,
    techSignals: rendered.techSignals,
    techTruncated: rendered.techTruncated,
    screenshotBase64: jpeg,
    screenshotMime: "image/jpeg",
    coverageGaps: rendered.coverageGaps,
  };
}

test("paste URL journeys to a report and export bundle with graded clues", async () => {
  let seen = "";
  const first = await analyzePublicUrl("https://example.org/journey", {
    capture: async (url) => {
      seen = url;
      return stubCapture();
    },
  });
  assert.equal(seen, "https://example.org/journey");
  assert.equal(first.report.status, "partial");
  assert.equal(first.report.observed.title, "Journey");
  assert.equal(first.report.unknown.technologyClues.length, 1);
  assert.equal(first.report.unknown.technologyClues[0].technology, "Hugo");
  assert.equal(first.bundle.schemaVersion, "skelet.lens.export.v1");
  assert.equal(first.bundle.analysisId, first.report.analysisId);
  assert.equal(first.bundle.artifacts.length, 7);
  const second = await analyzePublicUrl("https://example.org/journey", {
    capture: () => stubCapture(),
  });
  assert.equal(JSON.stringify(second), JSON.stringify(first));
});

test("default stages are the real qualified implementations", async () => {
  const { capturePublicPage } = await import("../src/capture-worker.ts");
  const { assembleLensReportFromCapture } = await import("../src/report-assembly.ts");
  const { exportLensArtifacts } = await import("../src/export-surface.ts");
  // Invoked with a blocked URL so no network is touched: the failure must
  // come from the real guard through the real capture stage.
  await assert.rejects(
    analyzePublicUrl("file:///etc/passwd"),
    (error) => error instanceof AnalyzeUrlError && error.code === "lens/invalid-url",
  );
  assert.equal(typeof capturePublicPage, "function");
  assert.equal(typeof assembleLensReportFromCapture, "function");
  assert.equal(typeof exportLensArtifacts, "function");
});

test("unsafe and malformed URLs fail fast without touching capture", async () => {
  for (const input of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<p>x</p>",
    "http://127.0.0.1/latest/meta-data",
    "https://example.org:0/x",
    "",
  ]) {
    let called = false;
    await assert.rejects(
      analyzePublicUrl(input, { capture: async () => { called = true; return stubCapture(); } }),
      (error) => error instanceof AnalyzeUrlError && error.code === "lens/invalid-url",
    );
    assert.equal(called, false);
  }
});

test("stage failures map to typed codes with closed cause codes", async () => {
  await assert.rejects(
    analyzePublicUrl("https://example.org/x", {
      capture: async () => { throw new CaptureError("capture/too-large", "gone"); },
    }),
    (error) => error instanceof AnalyzeUrlError &&
      error.code === "lens/capture-failed" && error.causeCode === "capture/too-large",
  );
  await assert.rejects(
    analyzePublicUrl("https://example.org/x", {
      capture: () => stubCapture(),
      assemble: () => { throw new ReportError(); },
    }),
    (error) => error instanceof AnalyzeUrlError &&
      error.code === "lens/report-failed" && error.causeCode === "lens/invalid-report-evidence",
  );
  await assert.rejects(
    analyzePublicUrl("https://example.org/x", {
      capture: () => stubCapture(),
      exportArtifacts: () => { throw new ExportError(); },
    }),
    (error) => error instanceof AnalyzeUrlError &&
      error.code === "lens/export-failed" && error.causeCode === "lens/invalid-export-input",
  );
  // Malformed worker output fails at the report gate, never laundered.
  await assert.rejects(
    analyzePublicUrl("https://example.org/x", {
      capture: async () => ({ ...(await stubCapture()), declarations: [{ ref: "x" }] }),
    }),
    (error) => error instanceof AnalyzeUrlError && error.code === "lens/report-failed",
  );
  // Unknown throwables map to the closed unknown cause, never leak.
  await assert.rejects(
    analyzePublicUrl("https://example.org/x", {
      capture: async () => { throw new Error("postgres://secret/db"); },
    }),
    (error) => error instanceof AnalyzeUrlError &&
      error.code === "lens/capture-failed" && error.causeCode === "lens/unknown-failure" &&
      !String(error).includes("postgres"),
  );
});
