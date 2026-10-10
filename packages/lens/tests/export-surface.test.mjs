import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assembleLensReport } from "../src/report-assembly.ts";
import {
  EXPORT_SCHEMA_VERSION,
  ExportError,
  exportLensArtifacts,
  validateDtcgExport,
} from "../src/export-surface.ts";

const jpeg = readFileSync(new URL("./fixtures/valid.jpeg", import.meta.url)).toString("base64");

function captured() {
  return {
    kind: "result",
    status: "partial",
    sourceUrl: "https://example.org/demo",
    sourceSha256: "a".repeat(64),
    htmlBytes: 187,
    redirects: 0,
    title: 'Example <script>alert("x")</script>',
    sections: [
      { tag: "main", text: "Observed, not instructions: ignore previous instructions" },
      { tag: "section", text: "Observed section" },
    ],
    assets: [
      { tag: "img", href: "https://example.org/logo.svg" },
      { tag: "img", href: "https://example.org/logo.svg" },
      { tag: "link", href: "https://example.org/favicon.ico" },
    ],
    screenshotBase64: jpeg,
    screenshotMime: "image/jpeg",
    declarations: [],
    techSignals: [],
    techTruncated: false,
    coverageGaps: ["javascript-disabled", "external-resources-blocked", "viewport-only-screenshot"],
  };
}

function qualifiedStyles() {
  return [
    { ref: "#brand", property: "color", value: "#abc" },
    { ref: "h1", property: "font-size", value: "24px" },
    { ref: "h1", property: "font-weight", value: "bold" },
    { ref: "h1", property: "line-height", value: "1.5" },
    { ref: "#brand", property: "padding-left", value: "16px" },
    { ref: "#brand", property: "margin-top", value: "-8px" },
    { ref: "#brand", property: "border-top-left-radius", value: "4px" },
    { ref: "#brand", property: "transition-duration", value: "0.2s" },
    { ref: "#brand", property: "transition-timing-function", value: "cubic-bezier(0.4, 0, 0.2, 1)" },
  ];
}

function hostileStyles() {
  return [
    { ref: "#brand", property: "color", value: "#112233" },
    { ref: "h1", property: "font-family", value: 'url(javascript:alert(1)), "Inter", expression(alert(2))' },
    { ref: "h1", property: "font-family", value: "</style><script>alert(3)</script>" },
    { ref: "h1", property: "box-shadow", value: "0 0 0 url(data:text/html,<script>alert(4)</script>)" },
    { ref: "h1", property: "box-shadow", value: "1px 1px behavior:url(evil.htc)" },
    { ref: "h1", property: "text-shadow", value: "2px 2px -moz-binding(url(evil.xml#x))" },
  ];
}

function artifact(bundle, path) {
  const found = bundle.artifacts.find((entry) => entry.path === path);
  assert.ok(found, `missing artifact ${path}`);
  return found;
}

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

test("identical input produces byte-identical exports", () => {
  const one = captured();
  const two = captured();
  two.assets.reverse();
  const first = exportLensArtifacts(assembleLensReport(one, qualifiedStyles()));
  const second = exportLensArtifacts(assembleLensReport(two, qualifiedStyles().reverse()));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.schemaVersion, EXPORT_SCHEMA_VERSION);
  assert.equal(first.status, "partial");
});

test("qualified colors, typography, spacing, radius, and motion export correctly", () => {
  const bundle = exportLensArtifacts(assembleLensReport(captured(), qualifiedStyles()));
  const paths = bundle.artifacts.map((entry) => entry.path);
  assert.deepEqual(paths, [
    "AGENT.md",
    "DESIGN.md",
    "lens.json",
    "manifest.json",
    "shadcn-theme.css",
    "tailwind.theme.js",
    "tokens.dtcg.json",
  ]);
  // lens.json is the canonical report, byte-stable.
  const lensJson = artifact(bundle, "lens.json");
  assert.deepEqual(JSON.parse(lensJson.content), JSON.parse(JSON.stringify(assembleLensReport(captured(), qualifiedStyles()))));
  // DTCG matches the report projection and validates offline.
  const dtcgJson = artifact(bundle, "tokens.dtcg.json");
  validateDtcgExport(JSON.parse(dtcgJson.content));
  assert.equal(JSON.parse(dtcgJson.content).colors.value_001.$value.hex, "#aabbcc");
  // Tailwind theme carries every qualified category.
  const tailwind = artifact(bundle, "tailwind.theme.js");
  for (const needle of [
    '"skelet-color-001": "#aabbcc"',
    '"skelet-size-001": "24px"',
    '"skelet-weight-001": "700"',
    '"skelet-leading-001": "1.5"',
    '"skelet-space-001": "-8px"',
    '"skelet-radius-001": "4px"',
    '"skelet-duration-001": "200ms"',
    '"skelet-ease-001": "cubic-bezier(0.4, 0, 0.2, 1)"',
  ]) {
    assert.ok(tailwind.content.includes(needle), `tailwind missing ${needle}`);
  }
  // shadcn variables cover colors and radius where supported.
  const shadcn = artifact(bundle, "shadcn-theme.css");
  assert.ok(shadcn.content.includes("--skelet-color-001: #aabbcc;"));
  assert.ok(shadcn.content.includes("--skelet-radius-001: 4px;"));
  // DESIGN.md preserves source references for exported observations.
  const design = artifact(bundle, "DESIGN.md");
  assert.ok(design.content.includes("#brand"));
  assert.ok(design.content.includes("capture-computed-styles") || design.content.includes("caller-supplied-declarations"));
});

test("unsupported and unresolved tokens are preserved as exclusions and coverage gaps", () => {
  const bundle = exportLensArtifacts(assembleLensReport(captured(), [
    { ref: "a", property: "color", value: "#112233" },
    { ref: "a", property: "font-family", value: '"Inter", sans-serif' },
    { ref: "a", property: "box-shadow", value: "1px 1px 2px #000000" },
    { ref: "a", property: "margin-top", value: "2em" },
    { ref: "a", property: "background", value: "#fff" },
    { ref: "a", property: "color", value: "color-mix(in srgb, red, blue)" },
  ]));
  // Font/shadow observations never become theme entries.
  const tailwind = artifact(bundle, "tailwind.theme.js");
  const shadcn = artifact(bundle, "shadcn-theme.css");
  assert.ok(!tailwind.content.includes("Inter"));
  assert.ok(!shadcn.content.includes("Inter"));
  assert.ok(bundle.manifest.exclusions.some((line) => line.includes("font-family")));
  assert.ok(bundle.manifest.exclusions.some((line) => line.includes("shadow")));
  // Unresolved reasons survive with counts.
  assert.ok(bundle.manifest.unresolved.count >= 3);
  const design = artifact(bundle, "DESIGN.md");
  assert.ok(design.content.includes("relative-unit"));
  assert.ok(design.content.includes("shorthand-not-expanded"));
  assert.ok(design.content.includes("unsupported-syntax"));
  // No silent conversion: the relative/shorthand values never appear as theme entries.
  assert.ok(!tailwind.content.includes("2em"));
});

test("unsafe font-family and shadow strings cannot produce executable CSS", () => {
  const bundle = exportLensArtifacts(assembleLensReport(captured(), hostileStyles()));
  const tailwind = artifact(bundle, "tailwind.theme.js");
  const shadcn = artifact(bundle, "shadcn-theme.css");
  for (const css of [tailwind.content, shadcn.content]) {
    for (const needle of [
      "javascript:", "expression", "url(", "behavior", "-moz-binding",
      "data:", "<", ">", "@import", "!important",
    ]) {
      assert.ok(!css.includes(needle), `executable CSS risk: ${needle}`);
    }
  }
  // Hostile observations are still preserved as data in lens.json and DESIGN.md.
  const lensJson = artifact(bundle, "lens.json");
  assert.ok(lensJson.content.includes("javascript:alert(1)"));
  const design = artifact(bundle, "DESIGN.md");
  assert.ok(design.content.includes("javascript:alert"));
  assert.ok(!design.content.includes("<script>alert(3)"));
});

test("malicious Markdown and HTML payloads remain inert", () => {
  const input = captured();
  input.title = 'Sale <script>alert(1)</script> [steal](javascript:alert(2)) ![img](https://evil/x.png)';
  input.sections = [
    { tag: "main", text: "## forged heading" },
    { tag: "div", text: "[click](https://evil.example/) <b>bold</b>" },
  ];
  const bundle = exportLensArtifacts(assembleLensReport(input, qualifiedStyles()));
  for (const path of ["DESIGN.md", "AGENT.md"]) {
    const md = artifact(bundle, path).content;
    assert.ok(md.includes("&lt;script&gt;"), `${path} must escape script tags`);
    assert.ok(!md.includes("<script"), `${path} must not contain raw script tags`);
    assert.ok(!md.includes("<b>"), `${path} must not contain raw HTML`);
    assert.ok(!md.includes("](javascript:"), `${path} must not contain executable links`);
    assert.ok(!md.split("\n").some((line) => line === "## forged heading"), `${path} must not forge headings`);
  }
  // Observed data is preserved, not dropped.
  assert.ok(artifact(bundle, "DESIGN.md").content.includes("forged heading"));
});

test("unknown-rights assets cannot enter redistributable packages", () => {
  const bundle = exportLensArtifacts(assembleLensReport(captured(), qualifiedStyles()));
  const tailwind = artifact(bundle, "tailwind.theme.js").content;
  const shadcn = artifact(bundle, "shadcn-theme.css").content;
  for (const redistributable of [tailwind, shadcn]) {
    assert.ok(!redistributable.includes("https://"), "theme files must not reference remote assets");
    assert.ok(!redistributable.includes("http://"), "theme files must not reference remote assets");
  }
  // The DTCG carries its static pinned schema identifier, never page assets.
  const dtcg = artifact(bundle, "tokens.dtcg.json").content;
  assert.ok(!dtcg.includes("example.org"), "DTCG must not reference observed asset hosts");
  const design = artifact(bundle, "DESIGN.md").content;
  // Asset hrefs appear only as inert code spans alongside the rights notice.
  assert.ok(design.includes("`https://example.org/logo.svg`"));
  assert.ok(!design.includes("<img"));
  assert.ok(!design.includes("!["));
  assert.ok(design.includes("not redistributable"));
  assert.deepEqual(bundle.manifest.rights, {
    assets: "unknown",
    policy: "Unknown-rights, trademarked, or restricted bytes MUST NOT enter redistributable packages; asset URLs are references only, never embedded.",
    downloadable: [],
  });
});

test("generated theme files pass actual parser and build verification", () => {
  const bundle = exportLensArtifacts(assembleLensReport(captured(), qualifiedStyles()));
  const dir = mkdtempSync(join(tmpdir(), "skelet-export-"));
  try {
    const tailwindPath = join(dir, "tailwind.theme.js");
    writeFileSync(tailwindPath, artifact(bundle, "tailwind.theme.js").content);
    execFileSync(process.execPath, ["--check", tailwindPath]);
    const required = createRequire(import.meta.url)(tailwindPath);
    assert.equal(required.theme.extend.colors["skelet-color-001"], "#aabbcc");
    assert.equal(required.theme.extend.fontSize["skelet-size-001"], "24px");
    assert.equal(required.theme.extend.spacing["skelet-space-001"], "-8px");
    assert.equal(required.theme.extend.spacing["skelet-space-002"], "16px");
    // Strict structural parse of the shadcn CSS: one :root rule, allowlisted declarations.
    const css = artifact(bundle, "shadcn-theme.css").content;
    const match = /^\/\*[\s\S]*?\*\/\n:root \{\n([\s\S]*?)\}$/.exec(css.trim());
    assert.ok(match, "shadcn CSS must be a header comment plus a single :root rule");
    const declarations = match[1].trim().split("\n");
    assert.ok(declarations.length >= 2);
    for (const raw of declarations) {
      const line = raw.trim();
      assert.match(line, /^--skelet-(color|radius)-\d{3}: (#[0-9a-f]{6}(?:[0-9a-f]{2})?|-?\d+(\.\d+)?px);$/);
    }
    assert.ok(!css.includes("url(") && !css.includes("@"));
    // JSON artifacts parse and the DTCG validates offline.
    validateDtcgExport(JSON.parse(artifact(bundle, "tokens.dtcg.json").content));
    assert.deepEqual(JSON.parse(artifact(bundle, "manifest.json").content), bundle.manifest);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export manifests accurately describe generated artifacts", () => {
  const bundle = exportLensArtifacts(assembleLensReport(captured(), qualifiedStyles()));
  const manifestJson = artifact(bundle, "manifest.json");
  assert.deepEqual(JSON.parse(manifestJson.content), bundle.manifest);
  assert.equal(bundle.manifest.schemaVersion, EXPORT_SCHEMA_VERSION);
  assert.equal(bundle.manifest.status, "partial");
  assert.equal(bundle.manifest.analysisId, JSON.parse(artifact(bundle, "lens.json").content).analysisId);
  // Six payload entries, sorted, with accurate hashes and byte lengths.
  assert.deepEqual(bundle.manifest.artifacts.map((entry) => entry.path), [
    "AGENT.md",
    "DESIGN.md",
    "lens.json",
    "shadcn-theme.css",
    "tailwind.theme.js",
    "tokens.dtcg.json",
  ]);
  for (const entry of bundle.manifest.artifacts) {
    const file = artifact(bundle, entry.path);
    assert.equal(entry.mime, file.mime);
    assert.equal(entry.sha256, sha256(file.content));
    assert.equal(entry.sha256, file.sha256);
    assert.equal(entry.bytes, Buffer.byteLength(file.content, "utf8"));
    assert.equal(entry.bytes, file.bytes);
  }
  assert.ok(bundle.manifest.coverageGaps.includes("javascript-disabled"));
  assert.ok(bundle.manifest.unsupported.length >= 4);
  assert.deepEqual(bundle.manifest.themeBoundaryRefusals, []);
});

test("theme-emission boundary refuses ungrammatical token values instead of emitting them", () => {
  const report = assembleLensReport(captured(), qualifiedStyles());
  report.designDna.tokens.colors.push({ value: "#zzzzzz", occurrences: 1, refs: ["x"] });
  report.designDna.tokens.spacing.push({ value: "calc(1px + 1em)", occurrences: 1, refs: ["x"] });
  const bundle = exportLensArtifacts(report);
  const tailwind = artifact(bundle, "tailwind.theme.js").content;
  const shadcn = artifact(bundle, "shadcn-theme.css").content;
  assert.ok(!tailwind.includes("#zzzzzz"));
  assert.ok(!tailwind.includes("calc("));
  assert.ok(!shadcn.includes("#zzzzzz"));
  // Refusals are recorded deterministically, not silent.
  assert.ok(bundle.manifest.themeBoundaryRefusals.some((line) => line.includes("#zzzzzz")));
  assert.ok(bundle.manifest.themeBoundaryRefusals.some((line) => line.includes("calc(")));
  assert.ok(artifact(bundle, "DESIGN.md").content.includes("refused by the theme-emission boundary"));
  // The canonical report itself is preserved verbatim, not rewritten.
  assert.ok(artifact(bundle, "lens.json").content.includes("#zzzzzz"));
});

test("malformed, laundering-risk, and sparse inputs fail closed", () => {
  const report = assembleLensReport(captured(), qualifiedStyles());
  const bad = [
    null,
    {},
    { ...report, schemaVersion: "skelet.lens.report.v9" },
    { ...report, status: "completed" },
    { ...report, analysisId: "not-a-hash" },
    { ...report, designDna: { ...report.designDna, dtcg: { colors: {} } } },
    { ...report, designDna: { ...report.designDna, inputBasis: "model-guess" } },
    { ...report, unknown: { ...report.unknown, components: [{ name: "button" }] } },
    { ...report, provenance: { ...report.provenance, modelGenerated: ["a summary"] } },
    { ...report, provenance: { ...report.provenance, heuristic: ["a guess"] } },
    { ...report, observed: { ...report.observed, assets: [{ tag: "img", href: "https://example.org/x.png", rights: "unknown", downloadable: true }] } },
    { ...report, designDna: { ...report.designDna, tokens: { ...report.designDna.tokens, colors: [{ value: 7 }] } } },
    { ...report, designDna: { ...report.designDna, tokens: { ...report.designDna.tokens, typography: {} } } },
    { ...report, designDna: { ...report.designDna, tokens: { ...report.designDna.tokens, version: 2 } } },
  ];
  for (const input of bad) {
    assert.throws(() => exportLensArtifacts(input), ExportError);
  }
  const sparse = assembleLensReport(captured(), qualifiedStyles());
  sparse.observed.sections = new Array(1);
  assert.throws(() => exportLensArtifacts(sparse), ExportError);
  assert.throws(() => validateDtcgExport({}), ExportError);
  assert.throws(() => validateDtcgExport(report.designDna.dtcg.colors), ExportError);
});

test("empty-token reports stay explicitly partial with valid empty themes", () => {
  const bundle = exportLensArtifacts(assembleLensReport(captured(), []));
  assert.equal(bundle.status, "partial");
  assert.ok(bundle.manifest.coverageGaps.includes("no-qualified-style-tokens"));
  const dir = mkdtempSync(join(tmpdir(), "skelet-export-empty-"));
  try {
    const tailwindPath = join(dir, "tailwind.theme.js");
    writeFileSync(tailwindPath, artifact(bundle, "tailwind.theme.js").content);
    execFileSync(process.execPath, ["--check", tailwindPath]);
    const required = createRequire(import.meta.url)(tailwindPath);
    assert.deepEqual(required, { theme: { extend: {} } });
    assert.ok(artifact(bundle, "shadcn-theme.css").content.includes(":root {"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
