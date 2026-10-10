import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  STYLE_EVIDENCE_BUDGET,
  STYLE_EVIDENCE_PROPERTIES,
  StyleEvidenceError,
  collectStyleEvidence,
  elementRef,
  projectPathSnapshots,
} from "../src/style-evidence.ts";
import { ReportError, assembleLensReportFromCapture } from "../src/report-assembly.ts";
import { validCaptureDeclarations } from "../src/capture-worker.ts";
import { renderOfflineSource } from "../src/capture-child.ts";

const jpeg = readFileSync(new URL("./fixtures/valid.jpeg", import.meta.url)).toString("base64");

function captured(declarations = []) {
  return {
    kind: "result",
    status: "partial",
    sourceUrl: "https://example.org/demo",
    sourceSha256: "a".repeat(64),
    htmlBytes: 187,
    redirects: 0,
    title: "Evidence",
    sections: [{ tag: "main", text: "Observed" }],
    assets: [{ tag: "img", href: "https://example.org/logo.svg" }],
    declarations,
    screenshotBase64: jpeg,
    screenshotMime: "image/jpeg",
    coverageGaps: ["javascript-disabled", "external-resources-blocked", "viewport-only-screenshot"],
  };
}

test("collector keeps only allowlisted properties in deterministic order", () => {
  const snapshots = [{
    ref: "main:nth(0)",
    styles: {
      color: "rgb(255, 0, 0)",
      "font-size": "24px",
      display: "grid",
      "--brand": "red",
      color2: "blue",
    },
  }];
  const declarations = collectStyleEvidence(snapshots);
  assert.deepEqual(declarations, [
    { ref: "main:nth(0)", property: "color", value: "rgb(255, 0, 0)" },
    { ref: "main:nth(0)", property: "font-size", value: "24px" },
  ]);
});

test("collector rejects over-budget, malformed, and oversized evidence", () => {
  const many = Array.from(
    { length: STYLE_EVIDENCE_BUDGET.maxElements + 1 },
    (_, i) => ({ ref: `p:nth(${String(i)})`, styles: { color: "red" } }),
  );
  assert.throws(() => collectStyleEvidence(many), StyleEvidenceError);
  assert.throws(() => collectStyleEvidence([{ ref: "", styles: {} }]), StyleEvidenceError);
  assert.throws(() => collectStyleEvidence([{ ref: "x", styles: null }]), StyleEvidenceError);
  assert.throws(() => collectStyleEvidence([{
    ref: "x", styles: { color: `red${" ".repeat(STYLE_EVIDENCE_BUDGET.maxValueChars)}` },
  }]), StyleEvidenceError);
  const holey = new Array(1);
  assert.throws(() => collectStyleEvidence(holey), StyleEvidenceError);
});

test("element refs are deterministic ASCII paths with bounded depth", () => {
  assert.equal(elementRef([{ tag: "BODY", index: 0 }]), "body:nth(0)");
  assert.equal(
    elementRef([{ tag: "body", index: 0 }, { tag: "MAIN", index: 1 }]),
    "body:nth(0) > main:nth(1)",
  );
  assert.throws(() => elementRef([]), StyleEvidenceError);
  assert.throws(() => elementRef(Array.from({ length: 7 }, () => ({ tag: "div", index: 0 }))), StyleEvidenceError);
  assert.throws(() => elementRef([{ tag: "div", index: -1 }]), StyleEvidenceError);
});

test("path snapshots project to deterministic refs and reject bad paths", () => {
  const projected = projectPathSnapshots([{
    segments: [{ tag: "html", index: 0 }, { tag: "body", index: 1 }, { tag: "main", index: 0 }],
    styles: { color: "red" },
  }]);
  assert.deepEqual(projected, [{
    ref: "html:nth(0) > body:nth(1) > main:nth(0)",
    styles: { color: "red" },
  }]);
  assert.throws(() => projectPathSnapshots([{ segments: [], styles: {} }]), StyleEvidenceError);
  assert.throws(() => projectPathSnapshots([{ segments: [{ tag: "div", index: 0 }] }]), StyleEvidenceError);
  assert.throws(() => projectPathSnapshots(
    Array.from({ length: STYLE_EVIDENCE_BUDGET.maxElements + 1 },
      () => ({ segments: [{ tag: "div", index: 0 }], styles: {} }))), StyleEvidenceError);
  assert.throws(() => projectPathSnapshots(new Array(1)), StyleEvidenceError);
});

test("worker validator fails closed on holes, shapes, and budgets", () => {
  assert.equal(validCaptureDeclarations([]), true);
  assert.equal(validCaptureDeclarations([{ ref: "a", property: "color", value: "#fff" }]), true);
  assert.equal(validCaptureDeclarations(new Array(1)), false);
  assert.equal(validCaptureDeclarations([{ ref: "a", property: "color" }]), false);
  assert.equal(validCaptureDeclarations([{ ref: "", property: "color", value: "#fff" }]), false);
  assert.equal(validCaptureDeclarations([{ ref: "a", property: "color", value: "" }]), false);
  assert.equal(validCaptureDeclarations("not-an-array"), false);
  assert.equal(validCaptureDeclarations(
    Array.from({ length: STYLE_EVIDENCE_BUDGET.maxDeclarations + 1 },
      (_, i) => ({ ref: `e${String(i)}`, property: "color", value: "#fff" })),), false);
});

test("offline capture attaches source-linked computed styles without running scripts", async () => {
  const fixture = {
    href: "https://example.org/styled",
    html: `<!doctype html><html><head><title>Styled</title>
      <style>main { color: #123456; font-size: 20px; }</style>
      <script>document.title = "UNSAFE SCRIPT RAN"</script>
      </head><body><main><h1>Observed heading</h1></main></body></html>`,
    sha256: "b".repeat(64),
    byteCount: 300,
    redirects: 0,
  };
  const result = await renderOfflineSource(fixture);
  assert.equal(result.title, "Styled");
  assert.ok(Array.isArray(result.declarations));
  assert.ok(result.declarations.length > 0);
  assert.ok(result.declarations.length <= STYLE_EVIDENCE_BUDGET.maxDeclarations);
  const observed = result.declarations.filter((item) => item.property === "color");
  assert.ok(observed.length > 0);
  assert.ok(observed.every((item) =>
    typeof item.ref === "string" && item.ref.length > 0 &&
    STYLE_EVIDENCE_PROPERTIES.includes(item.property)));
  const refs = new Set(result.declarations.map((item) => item.ref));
  assert.ok(refs.size >= 2);
  assert.ok([...refs].every((ref) => ref.includes(" > ") && ref.startsWith("html:nth(0)")));
  assert.deepEqual(result.coverageGaps, [
    "javascript-disabled", "external-resources-blocked", "viewport-only-screenshot",
  ]);
});

test("oversized computed values clip and record an explicit truncation gap", async () => {
  const longStack = Array.from({ length: 120 }, (_, i) => `"Family${String(i)}"`).join(", ");
  const fixture = {
    href: "https://example.org/wide",
    html: `<!doctype html><html><head><title>Wide</title>
      <style>p { font-family: ${longStack}; }</style>
      </head><body><main><p>Observed text</p></main></body></html>`,
    sha256: "c".repeat(64),
    byteCount: 900,
    redirects: 0,
  };
  const result = await renderOfflineSource(fixture);
  assert.ok(result.coverageGaps.includes("style-values-truncated"));
  assert.ok(result.declarations.every((item) =>
    item.ref.length <= STYLE_EVIDENCE_BUDGET.maxRefChars &&
    item.value.length <= STYLE_EVIDENCE_BUDGET.maxValueChars));
});

test("capture-to-report path binds computed evidence with capture provenance", () => {
  const declarations = [
    { ref: "main:nth(0)", property: "color", value: "#ff0000" },
    { ref: "h1:nth(1)", property: "font-size", value: "32px" },
    { ref: "h1:nth(1)", property: "font-family", value: 'url(javascript:alert(1)), "Inter"' },
  ];
  const report = assembleLensReportFromCapture(captured(declarations));
  assert.equal(report.designDna.inputBasis, "capture-computed-styles");
  assert.deepEqual(report.provenance.deterministic, ["design-tokens-from-capture"]);
  assert.deepEqual(
    report.provenance.observed,
    ["source", "title", "sections", "screenshot", "asset-links", "computed-styles"]);
  assert.ok(report.provenance.disclaimers.some((item) => item.includes("offline worker")));
  assert.equal(report.designDna.dtcg.colors.value_001.$value.hex, "#ff0000");
  assert.deepEqual(report.designDna.dtcg.fontSizes.value_001.$value, { value: 32, unit: "px" });
  assert.ok(!JSON.stringify(report.designDna.dtcg).includes("javascript:"));
  assert.match(report.analysisId, /^[0-9a-f]{64}$/);
});

test("capture-to-report path refuses empty tokens as complete and rejects bad evidence", () => {
  const empty = assembleLensReportFromCapture(captured([]));
  assert.equal(empty.status, "partial");
  assert.equal(empty.designDna.tokens.isEmpty, true);
  assert.ok(empty.provenance.coverageGaps.includes("no-qualified-style-tokens"));
  const bad = captured([{ ref: "x", property: "color" }]);
  assert.throws(() => assembleLensReportFromCapture(bad), ReportError);
});

test("capture and caller paths disagree only on declared provenance basis", () => {
  const declarations = [{ ref: "main:nth(0)", property: "color", value: "#00ff00" }];
  const fromCapture = assembleLensReportFromCapture(captured(declarations));
  assert.equal(fromCapture.designDna.inputBasis, "capture-computed-styles");
  assert.notEqual(fromCapture.provenance.deterministic[0], "design-tokens-from-supplied-declarations");
});
