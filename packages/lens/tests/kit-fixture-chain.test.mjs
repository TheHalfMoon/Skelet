import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import { renderOfflineSource } from "../src/capture-child.ts";
import { assembleLensReportFromCapture } from "../src/report-assembly.ts";
import { exportLensArtifacts } from "../src/export-surface.ts";
import { synthesizeStarterArtifacts } from "../src/starter-synthesis.ts";
import {
  assembleKitManifest,
  partitionKitArtifacts,
} from "../src/kit-manifest.ts";
import {
  buildKitPackage,
  finalizeKitManifest,
  parseKitPackage,
  sha256HexBytes,
} from "../src/kit-package.ts";

const HOME_HTML = `<!doctype html><html><head><title>Fixture Home</title></head><body><header>Home nav</header><main><section><h1>Home heading</h1><p>Home paragraph</p></section></main></body></html>`;

function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

test("fixture report chains to a validated shippable kit package", async () => {
  const rendered = await renderOfflineSource({
    href: "https://example.org/",
    html: HOME_HTML,
    sha256: "0".repeat(64),
    byteCount: HOME_HTML.length,
    redirects: 0,
  }, "desktop");
  assert.equal(rendered.viewport, "desktop");
  const report = assembleLensReportFromCapture(rendered);
  const bundle = exportLensArtifacts(report);
  assert.equal(bundle.analysisId, report.analysisId);

  const starter = synthesizeStarterArtifacts({
    analysisId: report.analysisId,
    sections: report.observed.sections.map((section) => ({ tag: section.tag, text: section.text })),
    colorCount: report.designDna.tokens.colors.length,
    spacingCount: report.designDna.tokens.spacing.length,
    hasTypography: report.designDna.tokens.typography.sizes.length > 0,
    truncated: false,
  });
  assert.equal(starter.length, 4);
  assert.ok(starter.every((file) => file.path.startsWith("starter/")));
  // Observed copy never enters starter bytes.
  assert.ok(!starter.some((file) => file.content.includes("Home paragraph")));

  const byPath = new Map(bundle.artifacts.map((artifact) => [artifact.path, artifact]));
  const lensJson = byPath.get("lens.json");
  assert.ok(lensJson);
  const screenshotBytes = Buffer.from(rendered.screenshotBase64, "base64");
  const screenshotPath = "screenshots/desktop-home.jpg";

  const kindOf = (path) => {
    if (path === "manifest.json") return "manifest";
    if (path === "lens.json") return "report";
    if (path === "DESIGN.md") return "design-record";
    if (path === "tokens.dtcg.json") return "tokens";
    if (path === "tailwind.theme.js" || path === "shadcn-theme.css") return "theme";
    if (path === "AGENT.md") return "agent-pack";
    if (path.startsWith("starter/")) return "starter-file";
    if (path.startsWith("screenshots/")) return "screenshot";
    throw new Error(`unexpected kit path ${path}`);
  };
  const entryOf = (path, content, classification) => ({
    path,
    kind: kindOf(path),
    sha256: sha256Text(content),
    bytes: Buffer.byteLength(content, "utf8"),
    classification,
  });

  const artifacts = [
    entryOf("lens.json", lensJson.content, "permitted"),
    entryOf("DESIGN.md", byPath.get("DESIGN.md").content, "permitted"),
    entryOf("tokens.dtcg.json", byPath.get("tokens.dtcg.json").content, "permitted"),
    entryOf("tailwind.theme.js", byPath.get("tailwind.theme.js").content, "permitted"),
    entryOf("shadcn-theme.css", byPath.get("shadcn-theme.css").content, "permitted"),
    entryOf("AGENT.md", byPath.get("AGENT.md").content, "permitted"),
    ...starter.map((file) => ({
      path: file.path,
      kind: "starter-file",
      sha256: sha256Text(file.content),
      bytes: file.bytes,
      classification: "permitted",
    })),
    {
      path: screenshotPath,
      kind: "screenshot",
      sha256: sha256HexBytes(screenshotBytes),
      bytes: screenshotBytes.byteLength,
      classification: "permitted",
    },
    // Placeholder keeps manifest.json well-formed before finalization.
    { path: "manifest.json", kind: "manifest", sha256: "a".repeat(64), bytes: 120, classification: "permitted" },
  ];

  const kitId = "f".repeat(64);
  const { manifest, manifestDoc } = finalizeKitManifest({
    kitId,
    analysisId: report.analysisId,
    status: "completed",
    report: { analysisId: report.analysisId, sha256: lensJson.sha256 },
    scope: { mode: "single-page", maxPages: 1, maxDepth: 0, maxBytes: 3000000, timeBudgetMs: 120000 },
    pages: [{ url: "https://example.org/", sha256: rendered.sourceSha256, viewport: "desktop", sectionRefs: [] }],
    artifacts,
    provenance: {
      observed: ["source", "title", "screenshot"],
      deterministic: ["design-tokens-from-capture"],
      coverageGaps: report.provenance.coverageGaps.slice(0, 8),
    },
  });
  assert.equal(manifest.schema_version, "skelet.lens.build-kit.v1");
  assert.equal(manifest.analysis_id, report.analysisId);
  const assembled = assembleKitManifest({
    kitId,
    analysisId: report.analysisId,
    status: "completed",
    report: { analysisId: report.analysisId, sha256: lensJson.sha256 },
    scope: { mode: "single-page", maxPages: 1, maxDepth: 0, maxBytes: 3000000, timeBudgetMs: 120000 },
    pages: [{ url: "https://example.org/", sha256: rendered.sourceSha256, viewport: "desktop", sectionRefs: [] }],
    artifacts,
    provenance: {
      observed: ["source", "title", "screenshot"],
      deterministic: ["design-tokens-from-capture"],
      coverageGaps: report.provenance.coverageGaps.slice(0, 8),
    },
  });
  assert.equal(assembled.artifacts.length, manifest.artifacts.length);

  const { shippable, withheld } = partitionKitArtifacts(manifest);
  assert.deepEqual(withheld, []);
  assert.ok(shippable.includes("manifest.json"));
  assert.ok(shippable.includes(screenshotPath));

  const documents = {
    "lens.json": new TextEncoder().encode(lensJson.content),
    "DESIGN.md": new TextEncoder().encode(byPath.get("DESIGN.md").content),
    "tokens.dtcg.json": new TextEncoder().encode(byPath.get("tokens.dtcg.json").content),
    "tailwind.theme.js": new TextEncoder().encode(byPath.get("tailwind.theme.js").content),
    "shadcn-theme.css": new TextEncoder().encode(byPath.get("shadcn-theme.css").content),
    "AGENT.md": new TextEncoder().encode(byPath.get("AGENT.md").content),
    "manifest.json": manifestDoc,
    [screenshotPath]: screenshotBytes,
  };
  for (const file of starter) {
    documents[file.path] = new TextEncoder().encode(file.content);
  }
  const pack = buildKitPackage(manifest, documents);
  assert.ok(pack.entryCount === shippable.length);
  assert.ok(pack.bytesTotal > 0);
  const parsed = parseKitPackage(pack.zip);
  assert.equal(parsed.length, pack.entryCount);
  assert.deepEqual(parsed.map((entry) => entry.path).sort(), [...shippable].sort());
}, { timeout: 60000 });

test("unknown-rights bytes are withheld from the shippable set", async () => {
  const rendered = await renderOfflineSource({
    href: "https://example.org/catalog",
    html: HOME_HTML,
    sha256: "1".repeat(64),
    byteCount: HOME_HTML.length,
    redirects: 0,
  }, "desktop");
  const report = assembleLensReportFromCapture(rendered);
  const bundle = exportLensArtifacts(report);
  const byPath = new Map(bundle.artifacts.map((artifact) => [artifact.path, artifact]));
  const lensJson = byPath.get("lens.json");
  const base = [
    { path: "lens.json", kind: "report", sha256: lensJson.sha256, bytes: lensJson.bytes, classification: "permitted" },
    { path: "DESIGN.md", kind: "design-record", sha256: byPath.get("DESIGN.md").sha256, bytes: byPath.get("DESIGN.md").bytes, classification: "permitted" },
    { path: "tokens.dtcg.json", kind: "tokens", sha256: byPath.get("tokens.dtcg.json").sha256, bytes: byPath.get("tokens.dtcg.json").bytes, classification: "permitted" },
    { path: "tailwind.theme.js", kind: "theme", sha256: byPath.get("tailwind.theme.js").sha256, bytes: byPath.get("tailwind.theme.js").bytes, classification: "permitted" },
    { path: "shadcn-theme.css", kind: "theme", sha256: byPath.get("shadcn-theme.css").sha256, bytes: byPath.get("shadcn-theme.css").bytes, classification: "permitted" },
    { path: "AGENT.md", kind: "agent-pack", sha256: byPath.get("AGENT.md").sha256, bytes: byPath.get("AGENT.md").bytes, classification: "permitted" },
    { path: "manifest.json", kind: "manifest", sha256: "a".repeat(64), bytes: 120, classification: "permitted" },
    { path: "starter/app/page.tsx", kind: "starter-file", sha256: "b".repeat(64), bytes: 90, classification: "unknown" },
  ];
  const input = {
    kitId: "e".repeat(64),
    analysisId: report.analysisId,
    status: "completed",
    report: { analysisId: report.analysisId, sha256: lensJson.sha256 },
    scope: { mode: "single-page", maxPages: 1, maxDepth: 0, maxBytes: 3000000, timeBudgetMs: 120000 },
    pages: [{ url: "https://example.org/catalog", sha256: rendered.sourceSha256, viewport: "desktop", sectionRefs: [] }],
    artifacts: base,
    provenance: { observed: ["source"], deterministic: ["tokens"], coverageGaps: [] },
  };
  const { manifest } = finalizeKitManifest(input);
  const { shippable, withheld } = partitionKitArtifacts(manifest);
  assert.ok(!shippable.includes("starter/app/page.tsx"));
  assert.deepEqual(withheld, ["starter/app/page.tsx"]);
  const byRights = new Map(manifest.artifacts.map((entry) => [entry.path, entry.rights]));
  assert.equal(byRights.get("starter/app/page.tsx").redistributable, false);
  assert.equal(byRights.get("lens.json").redistributable, true);
}, { timeout: 60000 });
