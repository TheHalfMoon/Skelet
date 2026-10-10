import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  TECH_SIGNAL_BUDGET,
  TECH_SIGNAL_HINT_RELS,
  TECH_SIGNAL_KINDS,
  TechSignalError,
  collectTechSignals,
  projectTechPathSignals,
  validTechSignals,
} from "../src/tech-signal-evidence.ts";
import { validCaptureDeclarations } from "../src/capture-worker.ts";
import {
  ReportError,
  assembleLensReport,
  assembleLensReportFromCapture,
} from "../src/report-assembly.ts";
import { ExportError, exportLensArtifacts } from "../src/export-surface.ts";
import { renderOfflineSource } from "../src/capture-child.ts";

const jpeg = readFileSync(new URL("./fixtures/valid.jpeg", import.meta.url)).toString("base64");

function captured(overrides = {}) {
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
    declarations: [],
    techSignals: [],
    techTruncated: false,
    screenshotBase64: jpeg,
    screenshotMime: "image/jpeg",
    coverageGaps: ["javascript-disabled", "external-resources-blocked", "viewport-only-screenshot"],
    ...overrides,
  };
}

function signal(overrides = {}) {
  return {
    kind: "script-src",
    value: "https://example.org/app.js",
    ref: "html:nth(0) > head:nth(0) > script:nth(1)",
    detail: "src",
    ...overrides,
  };
}

test("budgets keep honest renders inside the fail-closed gate", () => {
  assert.deepEqual([...TECH_SIGNAL_KINDS].sort(), [
    "dom-marker",
    "meta-generator",
    "resource-hint",
    "script-src",
    "stylesheet-href",
  ]);
  assert.ok(TECH_SIGNAL_HINT_RELS.includes("preload"));
  assert.ok(TECH_SIGNAL_HINT_RELS.includes("manifest"));
  const candidates =
    TECH_SIGNAL_BUDGET.maxMetaCandidates +
    TECH_SIGNAL_BUDGET.maxScriptCandidates +
    TECH_SIGNAL_BUDGET.maxStylesheetCandidates +
    TECH_SIGNAL_BUDGET.maxHintCandidates +
    TECH_SIGNAL_BUDGET.maxMarkerCandidates;
  assert.ok(candidates <= TECH_SIGNAL_BUDGET.maxSignals);
});

test("collector dedupes exact duplicates and orders deterministically", () => {
  const input = [
    signal({ value: "https://example.org/b.js" }),
    signal({ kind: "meta-generator", value: "ExampleCMS 1.0", ref: "html:nth(0)", detail: "content" }),
    signal({ value: "https://example.org/b.js" }),
    signal({ value: "https://example.org/a.js", ref: "html:nth(0) > head:nth(0) > script:nth(0)" }),
  ];
  const first = collectTechSignals(input);
  const second = collectTechSignals([...input].reverse());
  assert.equal(first.length, 3);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.map((item) => item.kind), [
    "meta-generator",
    "script-src",
    "script-src",
  ]);
  assert.deepEqual(first.map((item) => item.value), [
    "ExampleCMS 1.0",
    "https://example.org/a.js",
    "https://example.org/b.js",
  ]);
  // Near-duplicates that differ in any field are distinct observations.
  assert.equal(collectTechSignals([
    signal({ detail: "src" }),
    signal({ detail: "src", ref: "html:nth(0) > head:nth(0) > script:nth(2)" }),
  ]).length, 2);
});

test("collector rejects unknown kinds, shapes, budgets, and sparse holes", () => {
  assert.throws(() => collectTechSignals([{ ...signal(), kind: "framework" }]), TechSignalError);
  assert.throws(() => collectTechSignals([{ ...signal(), value: "" }]), TechSignalError);
  assert.throws(() => collectTechSignals([{ ...signal(), value: "x".repeat(2_049) }]), TechSignalError);
  assert.throws(() => collectTechSignals([
    { ...signal(), kind: "meta-generator", value: "x".repeat(257), detail: "content" },
  ]), TechSignalError);
  assert.throws(() => collectTechSignals([
    { ...signal(), kind: "dom-marker", value: "x".repeat(257), detail: "class" },
  ]), TechSignalError);
  assert.throws(() => collectTechSignals([{ ...signal(), ref: "" }]), TechSignalError);
  assert.throws(() => collectTechSignals([{ ...signal(), detail: "__proto__" }]), TechSignalError);
  assert.throws(() => collectTechSignals([{ ...signal(), detail: "has space" }]), TechSignalError);
  assert.throws(() => collectTechSignals([{ ...signal(), detail: "x".repeat(65) }]), TechSignalError);
  assert.throws(() => collectTechSignals([{ kind: "script-src", value: "https://example.org/a.js" }]), TechSignalError);
  assert.throws(() => collectTechSignals("not-an-array"), TechSignalError);
  assert.throws(() => collectTechSignals(null), TechSignalError);
  assert.throws(() => collectTechSignals(
    Array.from({ length: TECH_SIGNAL_BUDGET.maxSignals + 1 }, (_, i) => signal({
      value: `https://example.org/${String(i)}.js`,
      ref: `html:nth(0) > head:nth(0) > script:nth(${String(i)})`,
    }))), TechSignalError);
  assert.throws(() => collectTechSignals(new Array(1)), TechSignalError);
  assert.throws(() => collectTechSignals([null]), TechSignalError);
  // Fixed keys only: crafted keys never become object keys.
  const polluted = collectTechSignals([signal()]);
  assert.equal(Object.hasOwn(polluted[0], "__proto__"), false);
  assert.deepEqual(Object.keys(polluted[0]).sort(), ["detail", "kind", "ref", "value"]);
});

test("path projection builds refs and rejects bad paths", () => {
  const projected = projectTechPathSignals([{
    kind: "stylesheet-href",
    value: "https://example.org/theme.css",
    detail: "href",
    segments: [{ tag: "html", index: 0 }, { tag: "head", index: 1 }, { tag: "link", index: 0 }],
  }]);
  assert.deepEqual(projected, [{
    kind: "stylesheet-href",
    value: "https://example.org/theme.css",
    ref: "html:nth(0) > head:nth(1) > link:nth(0)",
    detail: "href",
  }]);
  assert.throws(() => projectTechPathSignals([{ kind: "nope", value: "x", detail: "src", segments: [] }]), TechSignalError);
  assert.throws(() => projectTechPathSignals([{ kind: "script-src", value: "x", detail: "src", segments: [] }]), TechSignalError);
  assert.throws(() => projectTechPathSignals(new Array(1)), TechSignalError);
  assert.throws(() => projectTechPathSignals(
    Array.from({ length: TECH_SIGNAL_BUDGET.maxSignals + 1 },
      () => ({ kind: "script-src", value: "https://example.org/a.js", detail: "src", segments: [{ tag: "script", index: 0 }] }))),
    TechSignalError);
});

test("worker gate mirrors the collector fail-closed contract", () => {
  assert.equal(validTechSignals([]), true);
  assert.equal(validCaptureDeclarations([{ ref: "a", property: "color", value: "#fff" }]), true);
  assert.equal(validTechSignals(new Array(1)), false);
  assert.equal(validCaptureDeclarations(new Array(1)), false);
  assert.equal(validTechSignals([{ ...signal(), kind: " guessed" }]), false);
  // Duplicates are well-formed evidence, not a shape violation.
  assert.equal(validTechSignals([signal(), signal()]), true);
});

test("report carries signals as observations without inventing clues", () => {
  const techSignals = [
    signal({ value: "https://example.org/b.js" }),
    signal({ kind: "meta-generator", value: "ExampleCMS 9.9", ref: "html:nth(0)", detail: "content" }),
  ];
  const report = assembleLensReportFromCapture(captured({ techSignals }));
  assert.deepEqual(report.observed.techSignals.map((item) => item.value), [
    "ExampleCMS 9.9",
    "https://example.org/b.js",
  ]);
  assert.deepEqual(report.provenance.observed, [
    "source", "title", "sections", "screenshot", "asset-links", "computed-styles", "technology-signals",
  ]);
  assert.deepEqual(report.unknown.technologyClues, []);
  assert.ok(report.provenance.disclaimers.some((item) => item.includes("not verified technology identities")));
  assert.ok(!JSON.stringify(report).includes("confidence"));
  const callerPath = assembleLensReport(captured({ techSignals }), []);
  assert.deepEqual(callerPath.observed.techSignals, report.observed.techSignals);
  assert.ok(callerPath.provenance.observed.includes("technology-signals"));
});

test("report fails closed on malformed or inconsistent tech evidence", () => {
  const bad = [
    captured({ techSignals: [{ kind: "nope", value: "x", ref: "html:nth(0)", detail: "src" }] }),
    captured({ techSignals: [signal()], techTruncated: true }),
    captured({
      techSignals: [],
      coverageGaps: ["javascript-disabled", "external-resources-blocked", "viewport-only-screenshot", "tech-signals-truncated"],
    }),
    captured({ techSignals: "not-an-array" }),
    captured({ techTruncated: "yes" }),
    captured({
      techSignals: Array.from({ length: TECH_SIGNAL_BUDGET.maxSignals + 1 }, (_, i) => signal({
        value: `https://example.org/${String(i)}.js`,
        ref: `html:nth(0) > head:nth(0) > script:nth(${String(i)})`,
      })),
    }),
  ];
  for (const input of bad) {
    assert.throws(() => assembleLensReport(input, []), ReportError);
    assert.throws(() => assembleLensReportFromCapture(input), ReportError);
  }
});

test("export keeps signals as inert data and rejects malformed signals", () => {
  const report = assembleLensReportFromCapture(captured({
    techSignals: [
      signal({ value: "https://example.org/app.js" }),
      signal({ kind: "meta-generator", value: 'ExampleCMS </script><script>alert(1)</script>', ref: "html:nth(0)", detail: "content" }),
    ],
  }));
  const bundle = exportLensArtifacts(report);
  const design = bundle.artifacts.find((entry) => entry.path === "DESIGN.md");
  assert.ok(design);
  assert.ok(design.content.includes("observations only, never verified identities"));
  assert.ok(!design.content.includes("</script><script>"));
  assert.ok(bundle.manifest.coverageGaps.includes("javascript-disabled"));
  const tampered = JSON.parse(JSON.stringify(report));
  tampered.observed.techSignals = [{ kind: "script-src", value: "x" }];
  assert.throws(() => exportLensArtifacts(tampered), ExportError);
  const unknown = JSON.parse(JSON.stringify(report));
  unknown.unknown.technologyClues = [{ technology: "ExampleCMS" }];
  assert.throws(() => exportLensArtifacts(unknown), ExportError);
});

test("offline capture observes generator, scripts, stylesheets, hints, and markers without running code", async () => {
  const fixture = {
    href: "https://example.org/tech",
    html: `<!doctype html><html data-nextjs="" lang="en"><head>
      <title>Tech Fixture</title>
      <meta name="generator" content="ExampleCMS 9.9">
      <meta name="description" content="ignored">
      <link rel="stylesheet" href="/theme.css">
      <link rel="preload" href="/app.woff2" as="font">
      <script>document.title = "UNSAFE SCRIPT RAN"</script>
      <script src="/js/app.js"></script>
      <script src="https://cdn.example.org/lib.js"></script>
      <script src="/js/app.js"></script>
      </head><body class="wp-front home"><main><p>Observed</p></main></body></html>`,
    sha256: "d".repeat(64),
    byteCount: 700,
    redirects: 0,
  };
  const result = await renderOfflineSource(fixture);
  assert.equal(result.title, "Tech Fixture");
  assert.equal(result.techTruncated, false);
  assert.deepEqual(result.coverageGaps, [
    "javascript-disabled", "external-resources-blocked", "viewport-only-screenshot",
  ]);
  const byKind = new Map();
  for (const item of result.techSignals) {
    byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
  }
  assert.deepEqual(byKind.get("meta-generator").map((item) => item.value), ["ExampleCMS 9.9"]);
  // Identical URLs at different DOM positions are distinct position-linked
  // observations (refs differ); exact-duplicate collapsing is unit-tested.
  assert.deepEqual(byKind.get("script-src").map((item) => item.value), [
    "https://cdn.example.org/lib.js",
    "https://example.org/js/app.js",
    "https://example.org/js/app.js",
  ]);
  const appRefs = byKind.get("script-src").filter((item) => item.value === "https://example.org/js/app.js").map((item) => item.ref);
  assert.equal(new Set(appRefs).size, 2);
  assert.deepEqual(byKind.get("stylesheet-href").map((item) => item.value), [
    "https://example.org/theme.css",
  ]);
  assert.deepEqual(byKind.get("resource-hint").map((item) => `${item.detail}=${item.value}`), [
    "href:preload=https://example.org/app.woff2",
  ]);
  const markers = byKind.get("dom-marker") ?? [];
  assert.ok(markers.some((item) => item.detail === "class" && item.value === "wp-front home"));
  assert.ok(markers.some((item) => item.detail === "attr:data-nextjs" && item.value === "html"));
  assert.ok(markers.every((item) => !item.detail.startsWith("attr:") || !item.detail.includes("=")));
  // No data-* VALUES leak into evidence: the empty attribute above proves
  // names-only collection, and lang/description never appear.
  assert.ok(result.techSignals.every((item) => item.value !== "en"));
  assert.ok(result.techSignals.every((item) => item.value !== "ignored"));
  // Deterministic across runs on this platform.
  const again = await renderOfflineSource(fixture);
  assert.equal(JSON.stringify(again.techSignals), JSON.stringify(result.techSignals));
});

test("offline capture drops unsupported schemes and oversized values with an explicit gap", async () => {
  const fixture = {
    href: "https://example.org/hostile",
    html: `<!doctype html><html><head><title>Hostile</title>
      <meta name="generator" content="${"G".repeat(400)}">
      <script src="javascript:alert(1)"></script>
      <script src="data:text/javascript,alert(2)"></script>
      <script src="file:///etc/passwd"></script>
      <script src="/ok.js"></script>
      <link rel="stylesheet" href="ftp://example.org/theme.css">
      </head><body><main><p>Observed</p></main></body></html>`,
    sha256: "e".repeat(64),
    byteCount: 700,
    redirects: 0,
  };
  const result = await renderOfflineSource(fixture);
  assert.equal(result.techTruncated, true);
  assert.ok(result.coverageGaps.includes("tech-signals-truncated"));
  assert.ok(result.techSignals.every((item) =>
    !item.value.startsWith("javascript:") && !item.value.startsWith("data:") &&
    !item.value.startsWith("file:") && !item.value.startsWith("ftp:")));
  assert.deepEqual(
    result.techSignals.filter((item) => item.kind === "script-src").map((item) => item.value),
    ["https://example.org/ok.js"],
  );
  const generator = result.techSignals.find((item) => item.kind === "meta-generator");
  assert.ok(generator && generator.value.length === TECH_SIGNAL_BUDGET.maxMetaChars);
  const report = assembleLensReportFromCapture({
    ...captured(),
    sourceUrl: result.sourceUrl,
    sourceSha256: result.sourceSha256,
    htmlBytes: result.htmlBytes,
    redirects: result.redirects,
    title: result.title,
    sections: result.sections,
    assets: result.assets,
    declarations: result.declarations,
    screenshotBase64: jpeg,
    techSignals: result.techSignals,
    techTruncated: result.techTruncated,
    coverageGaps: result.coverageGaps,
  });
  assert.ok(report.provenance.coverageGaps.includes("tech-signals-truncated"));
  assert.deepEqual(report.unknown.technologyClues, []);
});

test("candidate cap overflows flag truncation instead of dropping silently", async () => {
  const scripts = Array.from({ length: 105 }, (_, i) => `<script src="/js/a${String(i)}.js"></script>`).join("");
  const fixture = {
    href: "https://example.org/crowded",
    html: `<!doctype html><html><head><title>Crowded</title>${scripts}</head><body><main><p>Observed</p></main></body></html>`,
    sha256: "0".repeat(64),
    byteCount: 4000,
    redirects: 0,
  };
  const result = await renderOfflineSource(fixture);
  assert.equal(result.techTruncated, true);
  assert.ok(result.coverageGaps.includes("tech-signals-truncated"));
  const scriptsOut = result.techSignals.filter((item) => item.kind === "script-src");
  assert.equal(scriptsOut.length, TECH_SIGNAL_BUDGET.maxScriptCandidates);
  assert.ok(result.techSignals.length <= TECH_SIGNAL_BUDGET.maxSignals);
});

test("overlong data-attribute names skip with a flag instead of failing capture", async () => {
  const longName = `data-${"n".repeat(60)}`;
  const fixture = {
    href: "https://example.org/attrs",
    html: `<!doctype html><html ${longName}="" data-ok="1"><head><title>Attrs</title></head><body><main><p>Observed</p></main></body></html>`,
    sha256: "1".repeat(64),
    byteCount: 300,
    redirects: 0,
  };
  const result = await renderOfflineSource(fixture);
  assert.equal(result.techTruncated, true);
  assert.ok(result.coverageGaps.includes("tech-signals-truncated"));
  assert.ok(result.techSignals.some((item) => item.detail === "attr:data-ok"));
  assert.ok(result.techSignals.every((item) => item.detail.length <= TECH_SIGNAL_BUDGET.maxDetailChars));
});

test("offline capture stays honest on pages with no signals", async () => {  const fixture = {
    href: "https://example.org/plain",
    html: `<!doctype html><html><head><title>Plain</title></head><body><main><p>Observed</p></main></body></html>`,
    sha256: "f".repeat(64),
    byteCount: 120,
    redirects: 0,
  };
  const result = await renderOfflineSource(fixture);
  assert.deepEqual(result.techSignals, []);
  assert.equal(result.techTruncated, false);
  assert.ok(!result.coverageGaps.includes("tech-signals-truncated"));
  const report = assembleLensReportFromCapture({
    ...captured(),
    sourceUrl: result.sourceUrl,
    sourceSha256: result.sourceSha256,
    htmlBytes: result.htmlBytes,
    redirects: result.redirects,
    title: result.title,
    sections: result.sections,
    assets: result.assets,
    declarations: result.declarations,
    screenshotBase64: jpeg,
    techSignals: result.techSignals,
    techTruncated: result.techTruncated,
    coverageGaps: result.coverageGaps,
  });
  assert.deepEqual(report.observed.techSignals, []);
  assert.deepEqual(report.unknown.technologyClues, []);
});
