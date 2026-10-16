import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  ReportError,
  assembleLensReport,
  attachVideoEvidence,
} from "../src/report-assembly.ts";
import {
  assembleVideoEvidence,
  authenticateFrame,
  selectFrameRefs,
  validateVideoEvidenceRecord,
  validateVideoSource,
} from "../src/video-frame-evidence.ts";

const jpegBase64 = readFileSync(new URL("./fixtures/valid.jpeg", import.meta.url)).toString("base64");
const jpeg = new Uint8Array(readFileSync(new URL("./fixtures/valid.jpeg", import.meta.url)));

function captured() {
  return {
    kind: "result",
    status: "partial",
    sourceUrl: "https://example.org/demo",
    sourceSha256: "a".repeat(64),
    htmlBytes: 187,
    redirects: 0,
    title: "Example fixture",
    viewport: "desktop",
    sections: [{ tag: "main", text: "Observed section" }],
    assets: [],
    screenshotBase64: jpegBase64,
    screenshotMime: "image/jpeg",
    declarations: [],
    techSignals: [],
    techTruncated: false,
    coverageGaps: ["javascript-disabled", "external-resources-blocked", "viewport-only-screenshot"],
  };
}

function styles() {
  return [
    { ref: "#brand", property: "color", value: "#abc" },
    { ref: "h1", property: "font-size", value: "24px" },
  ];
}

function evidence() {
  const spec = validateVideoSource({
    videoSha256: "c".repeat(64),
    fps: 30,
    durationMs: 2000,
    width: 20,
    height: 20,
    frameCount: 60,
  });
  const refs = selectFrameRefs(spec, 4);
  const frames = refs.map((ref) => authenticateFrame(spec, ref.index, jpeg));
  return assembleVideoEvidence(spec, frames, new Date("2026-10-13T00:00:00.000Z"));
}

test("attaching valid video evidence extends the report deterministically", () => {
  const base = assembleLensReport(captured(), styles());
  assert.equal("videoEvidence" in base.observed, false);
  const attached = attachVideoEvidence(base, evidence());
  assert.ok(attached.observed.videoEvidence);
  assert.equal(attached.observed.videoEvidence.videoSha256, "c".repeat(64));
  assert.equal(attached.observed.videoEvidence.frames.length, 4);
  assert.ok(attached.provenance.observed.includes("video-frames"));
  assert.ok(attached.provenance.deterministic.includes("video-frame-evidence-mapping"));
  assert.match(attached.analysisId, /^[0-9a-f]{64}$/);
  assert.notEqual(attached.analysisId, base.analysisId);
  // Input report is never mutated.
  assert.equal("videoEvidence" in base.observed, false);
  // Deterministic: same inputs attach identically.
  const again = attachVideoEvidence(base, evidence());
  assert.deepEqual(again, attached);
});

test("re-attachment and malformed inputs fail closed", () => {
  const base = assembleLensReport(captured(), styles());
  const attached = attachVideoEvidence(base, evidence());
  assert.throws(() => attachVideoEvidence(attached, evidence()), ReportError);
  const good = evidence();
  const retimed = JSON.parse(JSON.stringify(good));
  retimed.frames[0].tMs += 1;
  assert.throws(() => attachVideoEvidence(base, retimed), ReportError);
  const reshaded = JSON.parse(JSON.stringify(good));
  reshaded.evidenceSha256 = "0".repeat(64);
  assert.throws(() => attachVideoEvidence(base, reshaded), ReportError);
  const emptied = JSON.parse(JSON.stringify(good));
  emptied.frames = [];
  assert.throws(() => attachVideoEvidence(base, emptied), ReportError);
  assert.throws(() => attachVideoEvidence(base, null), ReportError);
  assert.throws(() => attachVideoEvidence(base, { schema: "skilit/video-frame-evidence/9" }), ReportError);
  assert.throws(() => attachVideoEvidence(null, good), ReportError);
  assert.throws(() => attachVideoEvidence({ schemaVersion: "skilit.lens.report.v9" }, good), ReportError);
  // The re-authentication path is the same validator unit-covered in AF-06-i.
  assert.deepEqual(validateVideoEvidenceRecord(JSON.parse(JSON.stringify(good))), good);
});
