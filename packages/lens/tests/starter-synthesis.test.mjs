import assert from "node:assert/strict";
import test from "node:test";

import {
  STARTER_FILES,
  StarterError,
  SYNTHESIS_HEADER,
  synthesizeStarterArtifacts,
} from "../src/starter-synthesis.ts";

const ANALYSIS = "d".repeat(64);

function request(overrides = {}) {
  return {
    analysisId: ANALYSIS,
    sections: [{ tag: "hero" }, { tag: "features" }],
    colorCount: 6,
    spacingCount: 4,
    hasTypography: true,
    truncated: false,
    ...overrides,
  };
}

function byPath(files) {
  return new Map(files.map((file) => [file.path, file.content]));
}

test("fixed file set with synthesis headers and byte counts", () => {
  const files = synthesizeStarterArtifacts(request());
  assert.deepEqual(files.map((file) => file.path), [...STARTER_FILES]);
  const contents = byPath(files);
  assert.ok((contents.get("starter/app/page.tsx") ?? "").includes(SYNTHESIS_HEADER));
  assert.ok((contents.get("starter/app/layout.tsx") ?? "").includes(SYNTHESIS_HEADER));
  assert.ok((contents.get("starter/README.md") ?? "").includes(SYNTHESIS_HEADER));
  assert.ok((contents.get("starter/README.md") ?? "").includes(ANALYSIS));
  for (const file of files) {
    assert.equal(file.bytes, new TextEncoder().encode(file.content).byteLength);
    assert.ok(file.bytes > 0);
  }
});

test("observed site text is never copied into the starter", () => {
  const distinctive = "quixotic-zebra-meridian-copy-never-repeat";
  const files = synthesizeStarterArtifacts(request({
    sections: [{ tag: "hero", text: distinctive }],
  }));
  for (const file of files) {
    assert.ok(!file.content.includes(distinctive), file.path);
  }
  const page = byPath(files).get("starter/app/page.tsx") ?? "";
  assert.ok(page.includes("Replace with your own copy"));
  assert.ok(page.includes("Section: hero"));
});

test("section tags are HTML-escaped", () => {
  const files = synthesizeStarterArtifacts(request({
    sections: [{ tag: `hero\"><script>alert(1)</script>` }],
  }));
  const page = byPath(files).get("starter/app/page.tsx") ?? "";
  assert.ok(!page.includes("<script>alert(1)</script>"));
  assert.ok(page.includes("&lt;script&gt;"));
  assert.ok(page.includes("&quot;&gt;"));
});

test("package.json carries pinned Skelet defaults and parses", () => {
  const files = synthesizeStarterArtifacts(request());
  const pkg = JSON.parse(byPath(files).get("starter/package.json") ?? "{}");
  assert.equal(pkg.private, true);
  assert.ok(typeof pkg.dependencies.next === "string");
  assert.ok(typeof pkg.dependencies.react === "string");
  assert.ok(typeof pkg.devDependencies.tailwindcss === "string");
});

test("token basis and coverage notes are honest", () => {
  const full = byPath(synthesizeStarterArtifacts(request())).get("starter/README.md") ?? "";
  assert.ok(full.includes("Observed colors: 6"));
  assert.ok(full.includes("All observed sections are represented as placeholders"));
  const many = Array.from({ length: 20 }, (_, i) => ({ tag: `s${i}` }));
  const trimmed = byPath(synthesizeStarterArtifacts(request({ sections: many }))).get("starter/README.md") ?? "";
  assert.ok(trimmed.includes("8 observed section(s) omitted beyond the 12-section starter cap"));
  const upstream = byPath(synthesizeStarterArtifacts(request({ truncated: true }))).get("starter/README.md") ?? "";
  assert.ok(upstream.includes("Upstream inventory was truncated"));
});

test("empty sections produce an explicit empty-state stub", () => {
  const page = byPath(synthesizeStarterArtifacts(request({ sections: [] }))).get("starter/app/page.tsx") ?? "";
  assert.ok(page.includes("Empty starter"));
  assert.ok(page.includes("No sections were observed"));
});

test("remaining validation branches fail closed", () => {
  assert.throws(
    () => synthesizeStarterArtifacts(request({ sections: [{ tag: "s", text: "x".repeat(100001) }] })),
    StarterError,
  );
  assert.throws(() => synthesizeStarterArtifacts(request({ sections: ["hero"] })), StarterError);
  assert.throws(() => synthesizeStarterArtifacts(request({ sections: "hero" })), StarterError);
  assert.throws(() => synthesizeStarterArtifacts(request({ colorCount: 1.5 })), StarterError);
  assert.throws(() => synthesizeStarterArtifacts(request({ spacingCount: Number.NaN })), StarterError);
  assert.throws(() => synthesizeStarterArtifacts(request({ truncated: 0 })), StarterError);
  assert.throws(() => synthesizeStarterArtifacts(request({ analysisId: 42 })), StarterError);
});

test("layout references the kit theme siblings and the section cap holds", () => {
  const layout = byPath(synthesizeStarterArtifacts(request())).get("starter/app/layout.tsx") ?? "";
  assert.ok(layout.includes("../../shadcn-theme.css"));
  const many = Array.from({ length: 500 }, (_, i) => ({ tag: `s${i}` }));
  const files = synthesizeStarterArtifacts(request({ sections: many }));
  const page = byPath(files).get("starter/app/page.tsx") ?? "";
  assert.equal((page.match(/data-skelet-section=/g) ?? []).length, 12);
});
test("rebuilds are byte-identical", () => {
  const first = synthesizeStarterArtifacts(request());
  const second = synthesizeStarterArtifacts(request());
  assert.deepEqual(first, second);
});

test("malformed requests fail closed", () => {
  assert.throws(() => synthesizeStarterArtifacts(null), StarterError);
  assert.throws(() => synthesizeStarterArtifacts(request({ analysisId: "zz" })), StarterError);
  assert.throws(() => synthesizeStarterArtifacts(request({ sections: [{ tag: "" }] })), StarterError);
  assert.throws(
    () => synthesizeStarterArtifacts(request({ sections: [{ tag: "x".repeat(65) }] })),
    StarterError,
  );
  assert.throws(() => synthesizeStarterArtifacts(request({ colorCount: -1 })), StarterError);
  assert.throws(() => synthesizeStarterArtifacts(request({ hasTypography: "yes" })), StarterError);
  assert.throws(
    () => synthesizeStarterArtifacts(request({ sections: Array.from({ length: 501 }, () => ({ tag: "s" })) })),
    StarterError,
  );
  assert.throws(() => synthesizeStarterArtifacts(request({ unknownField: 1 })), StarterError);
});
