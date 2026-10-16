import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleKitManifest,
  GENERATED_LABEL,
  KitManifestError,
  KIT_MANIFEST_VERSION,
  partitionKitArtifacts,
  REDISTRIBUTABLE_NOTE,
} from "../src/kit-manifest.ts";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);

function fixedArtifacts() {
  return [
    { path: "manifest.json", kind: "manifest", sha256: HEX_A, bytes: 120, classification: "permitted" },
    { path: "lens.json", kind: "report", sha256: HEX_A, bytes: 340, classification: "permitted" },
    { path: "DESIGN.md", kind: "design-record", sha256: HEX_A, bytes: 210, classification: "permitted" },
    { path: "tokens.dtcg.json", kind: "tokens", sha256: HEX_A, bytes: 180, classification: "permitted" },
    { path: "tailwind.theme.js", kind: "theme", sha256: HEX_A, bytes: 150, classification: "permitted" },
    { path: "shadcn-theme.css", kind: "theme", sha256: HEX_A, bytes: 140, classification: "permitted" },
    { path: "AGENT.md", kind: "agent-pack", sha256: HEX_A, bytes: 200, classification: "permitted" },
  ];
}

function request(overrides = {}) {
  return {
    kitId: HEX_A,
    analysisId: HEX_B,
    status: "generating",
    report: { analysisId: HEX_B, sha256: HEX_C },
    scope: { mode: "selected-pages", maxPages: 3, maxDepth: 1, maxBytes: 3000000, timeBudgetMs: 120000 },
    pages: [
      { url: "https://example.org/a", sha256: HEX_A, viewport: "desktop", sectionRefs: ["hero"] },
      { url: "https://example.org/b", sha256: HEX_B, viewport: "mobile" },
    ],
    artifacts: fixedArtifacts(),
    provenance: { observed: ["title"], deterministic: ["tokens"], coverageGaps: [] },
    ...overrides,
  };
}

test("valid request assembles the frozen manifest shape", () => {
  const manifest = assembleKitManifest(request());
  assert.equal(manifest.schema_version, KIT_MANIFEST_VERSION);
  assert.equal(manifest.kit_id, HEX_A);
  assert.equal(manifest.status, "generating");
  assert.deepEqual(manifest.lens_report, {
    schema: "skilit.lens.report.v1",
    analysis_id: HEX_B,
    sha256: HEX_C,
  });
  assert.deepEqual(manifest.capture_scope, {
    mode: "selected-pages",
    max_pages: 3,
    max_depth: 1,
    max_bytes: 3000000,
    time_budget_ms: 120000,
  });
  assert.equal(manifest.pages.length, 2);
  assert.deepEqual(manifest.pages[1]?.section_refs, []);
  assert.equal(manifest.artifacts.length, 7);
  assert.ok(manifest.artifacts.every((entry) => entry.rights.redistributable === true));
  assert.equal(manifest.rights_policy.default_classification, "unknown");
  assert.equal(manifest.rights_policy.redistributable_note, REDISTRIBUTABLE_NOTE);
  assert.equal(manifest.provenance.generated_label, GENERATED_LABEL);
  assert.deepEqual(manifest.provenance.heuristic, []);
  assert.deepEqual(manifest.provenance.model_generated, []);
});

test("non-permitted bytes are never marked redistributable", () => {
  const artifacts = fixedArtifacts();
  artifacts.push(
    { path: "starter/app/page.tsx", kind: "starter-file", sha256: HEX_C, bytes: 90, classification: "unknown" },
    { path: "screenshots/desktop-a.jpg", kind: "screenshot", sha256: HEX_C, bytes: 800, classification: "restricted" },
  );
  const manifest = assembleKitManifest(request({ artifacts }));
  const byPath = new Map(manifest.artifacts.map((entry) => [entry.path, entry.rights]));
  assert.equal(byPath.get("starter/app/page.tsx")?.redistributable, false);
  assert.equal(byPath.get("screenshots/desktop-a.jpg")?.redistributable, false);
  assert.equal(byPath.get("lens.json")?.redistributable, true);
});

test("partition withholds every non-redistributable path in manifest order", () => {
  const artifacts = fixedArtifacts();
  artifacts.push(
    { path: "starter/app/page.tsx", kind: "starter-file", sha256: HEX_C, bytes: 90, classification: "trademarked" },
    { path: "screenshots/mobile-a.jpg", kind: "screenshot", sha256: HEX_C, bytes: 700, classification: "permitted" },
  );
  const manifest = assembleKitManifest(request({ artifacts }));
  const { shippable, withheld } = partitionKitArtifacts(manifest);
  assert.ok(!shippable.includes("starter/app/page.tsx"));
  assert.deepEqual(withheld, ["starter/app/page.tsx"]);
  assert.ok(shippable.includes("screenshots/mobile-a.jpg"));
});

test("report binding must equal the kit analysis ID", () => {
  assert.throws(
    () => assembleKitManifest(request({ report: { analysisId: HEX_C, sha256: HEX_C } })),
    KitManifestError,
  );
});

test("missing required exports fail closed", () => {
  const artifacts = fixedArtifacts().filter((entry) => entry.path !== "AGENT.md");
  assert.throws(() => assembleKitManifest(request({ artifacts })), KitManifestError);
});

test("path firewall rejects traversal, absolute, and mismatched-kind entries", () => {
  const bad = [
    "../lens.json",
    "/etc/lens.json",
    "starter/",
    "starter/app/page.tsx",
    "screenshots/x.jpg",
  ];
  const cases = [
    { path: "../lens.json", kind: "report", sha256: HEX_A, bytes: 10, classification: "permitted" },
    { path: "/etc/lens.json", kind: "report", sha256: HEX_A, bytes: 10, classification: "permitted" },
    { path: "starter/", kind: "starter-file", sha256: HEX_A, bytes: 10, classification: "permitted" },
    { path: "assets/logo.png", kind: "asset-inventory", sha256: HEX_A, bytes: 10, classification: "permitted" },
    { path: "lens.json", kind: "tokens", sha256: HEX_A, bytes: 10, classification: "permitted" },
    { path: "starter/app/page.tsx", kind: "screenshot", sha256: HEX_A, bytes: 10, classification: "permitted" },
  ];
  assert.equal(bad.length, 5);
  for (const entry of cases) {
    assert.throws(
      () => assembleKitManifest(request({ artifacts: [...fixedArtifacts(), entry] })),
      KitManifestError,
      entry.path,
    );
  }
});

test("duplicate artifact paths fail closed", () => {
  const artifacts = [...fixedArtifacts(), fixedArtifacts()[0]];
  assert.throws(() => assembleKitManifest(request({ artifacts })), KitManifestError);
});

test("page, scope, and status violations fail closed", () => {
  assert.throws(() => assembleKitManifest(request({ status: "shipped" })), KitManifestError);
  assert.throws(() => assembleKitManifest(request({ pages: [] })), KitManifestError);
  assert.throws(
    () => assembleKitManifest(request({
      pages: [{ url: "http://example.org/a", sha256: HEX_A, viewport: "desktop" }],
    })),
    KitManifestError,
  );
  assert.throws(
    () => assembleKitManifest(request({
      scope: { mode: "crawl", maxPages: 3, maxDepth: 1, maxBytes: 9, timeBudgetMs: 120000 },
    })),
    KitManifestError,
  );
  assert.throws(() => assembleKitManifest(request({ kitId: "zz" })), KitManifestError);
});

test("provenance and identity violations fail closed", () => {
  assert.throws(
    () => assembleKitManifest(request({ provenance: { observed: [""], deterministic: [], coverageGaps: [] } })),
    KitManifestError,
  );
  assert.throws(
    () => assembleKitManifest(request({ provenance: { observed: ["x".repeat(81)], deterministic: [], coverageGaps: [] } })),
    KitManifestError,
  );
  assert.throws(() => assembleKitManifest(request({ unknownField: 1 })), KitManifestError);
  assert.throws(() => assembleKitManifest(null), KitManifestError);
});

test("malformed partition input fails closed", () => {
  assert.throws(() => partitionKitArtifacts(null), KitManifestError);
  assert.throws(() => partitionKitArtifacts({ artifacts: [{ path: 7 }] }), KitManifestError);
});

test("every contract status assembles", () => {
  const statuses = ["queued", "capturing", "extracting", "generating", "validating", "completed", "partial", "failed", "canceled"];
  for (const status of statuses) {
    const manifest = assembleKitManifest(request({ status }));
    assert.equal(manifest.status, status);
  }
});

test("boundary integers are accepted at the edges and rejected outside", () => {
  const good = assembleKitManifest(request({
    scope: { mode: "single-page", maxPages: 25, maxDepth: 0, maxBytes: 1, timeBudgetMs: 1000 },
  }));
  assert.equal(good.capture_scope.max_pages, 25);
  const goodMax = assembleKitManifest(request({
    scope: { mode: "single-page", maxPages: 1, maxDepth: 3, maxBytes: 52428800, timeBudgetMs: 600000 },
  }));
  assert.equal(goodMax.capture_scope.max_depth, 3);
  const badScopes = [
    { mode: "single-page", maxPages: 0, maxDepth: 0, maxBytes: 1, timeBudgetMs: 1000 },
    { mode: "single-page", maxPages: 26, maxDepth: 0, maxBytes: 1, timeBudgetMs: 1000 },
    { mode: "single-page", maxPages: 1, maxDepth: 4, maxBytes: 1, timeBudgetMs: 1000 },
    { mode: "single-page", maxPages: 1, maxDepth: 0, maxBytes: 0, timeBudgetMs: 1000 },
    { mode: "single-page", maxPages: 1, maxDepth: 0, maxBytes: 1, timeBudgetMs: 999 },
    { mode: "single-page", maxPages: 1.5, maxDepth: 0, maxBytes: 1, timeBudgetMs: 1000 },
  ];
  for (const scope of badScopes) {
    assert.throws(() => assembleKitManifest(request({ scope })), KitManifestError);
  }
});

test("field-length and count boundaries fail closed", () => {
  assert.throws(
    () => assembleKitManifest(request({
      pages: [{ url: "https://example.org/a", sha256: HEX_A, viewport: "desktop", sectionRefs: ["x".repeat(257)] }],
    })),
    KitManifestError,
  );
  assert.throws(
    () => assembleKitManifest(request({
      pages: [{ url: `https://example.org/${"y".repeat(2048)}`, sha256: HEX_A, viewport: "desktop" }],
    })),
    KitManifestError,
  );
  assert.throws(
    () => assembleKitManifest(request({ pages: Array.from({ length: 26 }, () => request().pages[0]) })),
    KitManifestError,
  );
  assert.throws(() => assembleKitManifest(request({ artifacts: [] })), KitManifestError);
  const tiny = { path: "starter/x.ts", kind: "starter-file", sha256: HEX_A, bytes: 0, classification: "permitted" };
  assert.throws(() => assembleKitManifest(request({ artifacts: [...fixedArtifacts(), tiny] })), KitManifestError);
  const huge = { ...tiny, bytes: 16777217 };
  assert.throws(() => assembleKitManifest(request({ artifacts: [...fixedArtifacts(), huge] })), KitManifestError);
  const badClass = { ...tiny, bytes: 9, classification: "internal" };
  assert.throws(() => assembleKitManifest(request({ artifacts: [...fixedArtifacts(), badClass] })), KitManifestError);
});

test("all-permitted manifest ships everything and withholds nothing", () => {
  const { shippable, withheld } = partitionKitArtifacts(assembleKitManifest(request()));
  assert.equal(shippable.length, 7);
  assert.deepEqual(withheld, []);
});
