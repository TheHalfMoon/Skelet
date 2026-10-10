import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  TECH_CLUE_BUDGET,
  TECH_CLUE_PROVIDER,
  TECH_CLUE_RULES,
  TECH_CLUE_RULES_VERSION,
  TechClueError,
  matchTechnologyClues,
  validTechnologyClues,
} from "../src/tech-clue-matcher.ts";
import { TECH_SIGNAL_BUDGET, validTechSignals } from "../src/tech-signal-evidence.ts";
import {
  ReportError,
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

function gen(value, ref = "html:nth(0) > head:nth(0) > meta:nth(0)") {
  return { kind: "meta-generator", value, ref, detail: "content" };
}

function script(value, ref = "html:nth(0) > head:nth(0) > script:nth(0)") {
  return { kind: "script-src", value, ref, detail: "src" };
}

test("rule set is frozen, versioned, and honestly calibrated", () => {
  assert.equal(TECH_CLUE_RULES_VERSION, "skelet.tech-rules.v1");
  assert.ok(Object.isFrozen(TECH_CLUE_RULES));
  const ids = TECH_CLUE_RULES.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const rule of TECH_CLUE_RULES) {
    assert.match(rule.id, /^[a-z0-9-]+$/);
    assert.ok(rule.technology.length > 0);
    assert.ok(rule.kinds.length > 0);
    assert.ok(rule.confidence > 0 && rule.confidence < 1);
    assert.ok(rule.rationale.length > 0);
    assert.ok(rule.fpNote.length > 0);
  }
  // Calibration pins: generator banners high, URL markers low, nothing certain.
  const confidence = Object.fromEntries(TECH_CLUE_RULES.map((rule) => [rule.id, rule.confidence]));
  assert.deepEqual(confidence, {
    "gen-wordpress": 0.85,
    "gen-drupal": 0.85,
    "gen-joomla": 0.85,
    "gen-ghost": 0.85,
    "gen-hugo": 0.85,
    "gen-jekyll": 0.85,
    "url-shopify": 0.6,
    "path-wordpress": 0.5,
    "path-nextjs": 0.5,
    "path-ghost-admin": 0.55,
  });
});

test("generator banners match on prefix only, case-insensitively", () => {
  const found = matchTechnologyClues([gen("WordPress 6.7")]);
  assert.equal(found.length, 1);
  assert.equal(found[0].technology, "WordPress");
  assert.equal(found[0].confidence, 0.85);
  assert.deepEqual(found[0].ruleIds, ["gen-wordpress"]);
  assert.equal(matchTechnologyClues([gen("JOOMLA! - Open Source Content Management")])[0].technology, "Joomla");
  assert.equal(matchTechnologyClues([gen("drupal 10 (https://www.drupal.org)")])[0].technology, "Drupal");
  assert.equal(matchTechnologyClues([gen("Ghost 5.0")])[0].technology, "Ghost");
  assert.equal(matchTechnologyClues([gen("Hugo 0.120.0")])[0].technology, "Hugo");
  assert.equal(matchTechnologyClues([gen("Jekyll v4.3.2")])[0].technology, "Jekyll");
  // Mid-string mentions are NOT hits: prefix anchoring is the FP control.
  assert.deepEqual(matchTechnologyClues([gen("not wordpress really")]), []);
  assert.deepEqual(matchTechnologyClues([gen("mywordpress")]), []);
  // Empty values are invalid evidence and fail closed, never silent non-matches.
  assert.throws(() => matchTechnologyClues([gen("")]), TechClueError);
});

test("host suffixes are anchored against lookalike domains", () => {
  assert.equal(matchTechnologyClues([script("https://cdn.shopify.com/s/trekkie.js")])[0].technology, "Shopify");
  assert.equal(matchTechnologyClues([script("https://shop.myshopify.com/app.js")])[0].confidence, 0.6);
  assert.deepEqual(matchTechnologyClues([script("https://shopify.com.evil.org/x.js")]), []);
  assert.deepEqual(matchTechnologyClues([script("https://evilshopify.com/x.js")]), []);
  assert.deepEqual(matchTechnologyClues([script("https://example.org/shopify-replica.js")]), []);
});

test("path tokens respect segment boundaries", () => {
  const wp = matchTechnologyClues([script("https://example.org/wp-content/uploads/app.js")]);
  assert.equal(wp[0].technology, "WordPress");
  assert.equal(wp[0].confidence, 0.5);
  assert.equal(matchTechnologyClues([script("https://example.org/wp-includes/js/wp.js")])[0].technology, "WordPress");
  assert.equal(matchTechnologyClues([script("https://example.org/_next/static/chunk.js")])[0].technology, "Next.js");
  assert.deepEqual(matchTechnologyClues([script("https://example.org/mynextapp/bundle.js")]), []);
  assert.deepEqual(matchTechnologyClues([script("https://example.org/wordpress-backup/app.js")]), []);
  assert.equal(matchTechnologyClues([script("https://example.org/ghost/content/images/x.png")])[0].technology, "Ghost");
  assert.deepEqual(matchTechnologyClues([script("https://example.org/ghostwriter/app.js")]), []);
});

test("dom-marker signals are collected but unmatched in v1", () => {
  assert.deepEqual(matchTechnologyClues([
    { kind: "dom-marker", value: "wp-front", ref: "html:nth(0) > body:nth(1)", detail: "class" },
    { kind: "dom-marker", value: "html", ref: "html:nth(0)", detail: "attr:data-nextjs" },
  ]), []);
});

test("same-technology hits merge with max confidence and sorted evidence", () => {
  const clues = matchTechnologyClues([
    script("https://example.org/wp-content/a.js", "html:nth(0) > head:nth(0) > script:nth(2)"),
    script("https://example.org/wp-content/a.js", "html:nth(0) > head:nth(0) > script:nth(2)"),
    gen("WordPress 6.7"),
    script("https://example.org/wp-includes/b.js", "html:nth(0) > head:nth(0) > script:nth(0)"),
  ]);
  assert.equal(clues.length, 1);
  assert.equal(clues[0].technology, "WordPress");
  assert.equal(clues[0].confidence, 0.85);
  assert.deepEqual(clues[0].ruleIds, ["gen-wordpress", "path-wordpress"]);
  assert.deepEqual(clues[0].evidenceRefs, [
    "html:nth(0) > head:nth(0) > meta:nth(0)",
    "html:nth(0) > head:nth(0) > script:nth(0)",
    "html:nth(0) > head:nth(0) > script:nth(2)",
  ]);
  assert.equal(clues[0].truncatedRefs, false);
});

test("ranking is deterministic: confidence desc, technology asc", () => {
  const signals = [
    script("https://example.org/_next/a.js"),
    gen("WordPress 6.7"),
    script("https://cdn.shopify.com/b.js"),
  ];
  const first = matchTechnologyClues(signals);
  const second = matchTechnologyClues([...signals].reverse());
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.map((clue) => clue.technology), ["WordPress", "Shopify", "Next.js"]);
  assert.deepEqual(first.map((clue) => clue.confidence), [0.85, 0.6, 0.5]);
});

test("unknown stays honestly unknown", () => {
  assert.deepEqual(matchTechnologyClues([]), []);
  assert.deepEqual(matchTechnologyClues([script("https://example.org/app.js")]), []);
  for (const clues of [matchTechnologyClues([gen("WordPress 6.7")])]) {
    for (const clue of clues) {
      assert.ok(clue.confidence < 1);
    }
  }
});

test("matcher fails closed on malformed, sparse, or over-budget input", () => {
  assert.throws(() => matchTechnologyClues("not-an-array"), TechClueError);
  assert.throws(() => matchTechnologyClues(new Array(1)), TechClueError);
  assert.throws(() => matchTechnologyClues([{ kind: "nope", value: "x", ref: "html:nth(0)", detail: "src" }]), TechClueError);
  assert.throws(() => matchTechnologyClues(
    Array.from({ length: TECH_SIGNAL_BUDGET.maxSignals + 1 }, (_, i) => script(
      `https://example.org/${String(i)}.js`,
      `html:nth(0) > head:nth(0) > script:nth(${String(i)})`,
    ))), TechClueError);
});

test("clue validator accepts graded clues and rejects certainty or shapes", () => {
  const good = [{
    technology: "WordPress",
    confidence: 0.85,
    ruleIds: ["gen-wordpress"],
    evidenceRefs: ["html:nth(0)"],
    truncatedRefs: false,
  }];
  assert.equal(validTechnologyClues([]), true);
  assert.equal(validTechnologyClues(good), true);
  assert.equal(validTechnologyClues([{ ...good[0], confidence: 1 }]), false);
  assert.equal(validTechnologyClues([{ ...good[0], confidence: 0 }]), false);
  assert.equal(validTechnologyClues([{ ...good[0], confidence: Number.NaN }]), false);
  assert.equal(validTechnologyClues([{ ...good[0], confidence: "0.85" }]), false);
  assert.equal(validTechnologyClues([{ ...good[0], ruleIds: [] }]), false);
  assert.equal(validTechnologyClues([{ ...good[0], evidenceRefs: [] }]), false);
  assert.equal(validTechnologyClues([{ ...good[0], truncatedRefs: "no" }]), false);
  assert.equal(validTechnologyClues([{ ...good[0], technology: "" }]), false);
  assert.equal(validTechnologyClues(new Array(1)), false);
  assert.equal(validTechnologyClues("not-an-array"), false);
  assert.equal(validTechnologyClues(
    Array.from({ length: TECH_CLUE_BUDGET.maxClues + 1 }, () => good[0])), false);
});

test("provider descriptor mirrors the G05-02 contract shape", async () => {
  assert.equal(TECH_CLUE_PROVIDER.id, "skelet-tech-clues");
  assert.equal(TECH_CLUE_PROVIDER.capability, "technology-clues");
  assert.equal(TECH_CLUE_PROVIDER.version, TECH_CLUE_RULES_VERSION);
  assert.equal(TECH_CLUE_PROVIDER.egress, "none");
  assert.equal(TECH_CLUE_PROVIDER.costClass, "free-local");
  assert.ok(Object.isFrozen(TECH_CLUE_PROVIDER.config));
  assert.deepEqual(TECH_CLUE_PROVIDER.config.ruleIds, TECH_CLUE_RULES.map((rule) => rule.id));
  const signals = [gen("WordPress 6.7")];
  assert.equal(TECH_CLUE_PROVIDER.checkInput(signals), true);
  assert.equal(TECH_CLUE_PROVIDER.checkInput(new Array(1)), false);
  const output = await TECH_CLUE_PROVIDER.invoke(signals);
  assert.equal(TECH_CLUE_PROVIDER.checkOutput(output), true);
  assert.equal(TECH_CLUE_PROVIDER.checkOutput([{ technology: "X", confidence: 1 }]), false);
  assert.deepEqual(await TECH_CLUE_PROVIDER.health(), { ok: true, detail: "ready" });
  const provenance = TECH_CLUE_PROVIDER.provenance(signals, output);
  assert.equal(provenance.providerId, "skelet-tech-clues");
  assert.equal(provenance.capability, "technology-clues");
  assert.equal(provenance.egress, "none");
  assert.equal(provenance.rulesVersion, TECH_CLUE_RULES_VERSION);
  assert.equal(provenance.rulesEvaluated, TECH_CLUE_RULES.length);
  assert.equal(provenance.signalsSeen, 1);
  assert.equal(provenance.cluesEmitted, 1);
  assert.equal(validTechSignals(signals), true);
});

test("report carries graded clues with matcher provenance", () => {
  const report = assembleLensReportFromCapture(captured({
    techSignals: [
      gen("WordPress 6.7"),
      script("https://example.org/wp-content/a.js", "html:nth(0) > head:nth(0) > script:nth(1)"),
    ],
  }));
  assert.equal(report.unknown.technologyClues.length, 1);
  const clue = report.unknown.technologyClues[0];
  assert.equal(clue.technology, "WordPress");
  assert.equal(clue.confidence, 0.85);
  assert.ok(report.provenance.deterministic.some((item) => item.startsWith("technology-clues-from-owned-rules:")));
  assert.ok(report.provenance.disclaimers.some((item) => item.includes("never verified installations")));
  assert.deepEqual(report.unknown.components, []);
  assert.ok(!report.provenance.coverageGaps.includes("no-matched-technology-clues"));
});

test("unmatched signals stay unknown with an explicit gap", () => {
  const report = assembleLensReportFromCapture(captured({
    techSignals: [script("https://example.org/app.js")],
  }));
  assert.deepEqual(report.unknown.technologyClues, []);
  assert.ok(report.provenance.coverageGaps.includes("no-matched-technology-clues"));
  assert.equal(report.status, "partial");
});

test("export renders graded clues as data and rejects malformed clues", () => {
  const report = assembleLensReportFromCapture(captured({
    techSignals: [gen("Hugo 0.120.0"), script("https://example.org/_next/a.js")],
  }));
  const bundle = exportLensArtifacts(report);
  const design = bundle.artifacts.find((entry) => entry.path === "DESIGN.md");
  assert.ok(design);
  assert.ok(design.content.includes("never verified installations"));
  assert.ok(design.content.includes("Hugo"));
  assert.ok(design.content.includes("0.85"));
  assert.ok(design.content.includes("gen-hugo"));
  const agent = bundle.artifacts.find((entry) => entry.path === "AGENT.md");
  assert.ok(agent && agent.content.includes("evidence-graded"));
  const certain = JSON.parse(JSON.stringify(report));
  certain.unknown.technologyClues[0].confidence = 1;
  assert.throws(() => exportLensArtifacts(certain), ExportError);
  const invented = JSON.parse(JSON.stringify(report));
  invented.unknown.components = [{ name: "button" }];
  assert.throws(() => exportLensArtifacts(invented), ExportError);
});

test("end to end: offline capture to graded clues without running page scripts", async () => {
  const fixture = {
    href: "https://example.org/wp",
    html: `<!doctype html><html><head><title>WP Fixture</title>
      <meta name="generator" content="WordPress 6.7">
      <script>document.title = "UNSAFE SCRIPT RAN"</script>
      <script src="/wp-includes/js/wp-embed.js"></script>
      </head><body><main><p>Observed</p></main></body></html>`,
    sha256: "2".repeat(64),
    byteCount: 400,
    redirects: 0,
  };
  const result = await renderOfflineSource(fixture);
  assert.equal(result.title, "WP Fixture");
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
  assert.equal(report.unknown.technologyClues.length, 1);
  assert.equal(report.unknown.technologyClues[0].technology, "WordPress");
  assert.equal(report.unknown.technologyClues[0].confidence, 0.85);
  const again = assembleLensReportFromCapture({
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
  assert.equal(JSON.stringify(again.unknown.technologyClues), JSON.stringify(report.unknown.technologyClues));
  assert.throws(() => assembleLensReportFromCapture(captured({
    techSignals: [{ kind: "script-src", value: "https://example.org/a.js", ref: "html:nth(0)" }],
  })), ReportError);
});
