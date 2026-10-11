import assert from "node:assert/strict";
import test from "node:test";

import { assembleKitManifest } from "../src/kit-manifest.ts";
import {
  buildKitPackage,
  canonicalJsonBytes,
  crc32Bytes,
  finalizeKitManifest,
  KitPackageError,
  manifestSelfDigest,
  parseKitPackage,
  sha256HexBytes,
} from "../src/kit-package.ts";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);

function payload(text) {
  return new TextEncoder().encode(text);
}

const DOC_TEXTS = {
  "lens.json": "lens",
  "DESIGN.md": "design",
  "tokens.dtcg.json": "tokens",
  "tailwind.theme.js": "tailwind",
  "shadcn-theme.css": "shadcn",
  "AGENT.md": "agent",
};

const DOC_KINDS = {
  "lens.json": "report",
  "DESIGN.md": "design-record",
  "tokens.dtcg.json": "tokens",
  "tailwind.theme.js": "theme",
  "shadcn-theme.css": "theme",
  "AGENT.md": "agent-pack",
};

function fixedArtifacts(extra = []) {
  const placeholder = { path: "manifest.json", kind: "manifest", sha256: HEX_A, bytes: 4, classification: "permitted" };
  return [placeholder].concat(Object.entries(DOC_TEXTS).map(([path, text]) => {
    const data = payload(text);
    return { path, kind: DOC_KINDS[path], sha256: sha256HexBytes(data), bytes: data.byteLength, classification: "permitted" };
  })).concat(extra);
}

/** Finalized manifest plus its exact manifest.json bytes (self digest rule). */
function selfConsistentManifest(overrides = {}) {
  const stub = { path: "starter/app/page.tsx", kind: "starter-file", sha256: HEX_C, bytes: 9, classification: "unknown" };
  return finalizeKitManifest({
    kitId: HEX_A,
    analysisId: HEX_B,
    status: "validating",
    report: { analysisId: HEX_B, sha256: HEX_C },
    scope: { mode: "single-page", maxPages: 1, maxDepth: 0, maxBytes: 1000000, timeBudgetMs: 60000 },
    pages: [{ url: "https://example.org/", sha256: HEX_A, viewport: "desktop" }],
    artifacts: fixedArtifacts([stub]),
    provenance: { observed: ["title"], deterministic: ["scope"], coverageGaps: [] },
    ...overrides,
  });
}

function shippableDocuments(withheldIncluded = false) {
  const { manifest, manifestDoc } = selfConsistentManifest();
  const docs = { "manifest.json": manifestDoc };
  for (const [path, text] of Object.entries(DOC_TEXTS)) docs[path] = payload(text);
  if (withheldIncluded) docs["starter/app/page.tsx"] = payload("unknown!");
  return { manifest, docs };
}

test("crc32 and sha256 match known vectors", () => {
  assert.equal(crc32Bytes(payload("123456789")).toString(16), "cbf43926");
  assert.equal(
    sha256HexBytes(payload("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("canonical JSON is key-ordered and compact", () => {
  const first = canonicalJsonBytes({ b: 1, a: [3, 2] });
  const second = canonicalJsonBytes({ a: [3, 2], b: 1 });
  assert.deepEqual(first, second);
  assert.equal(new TextDecoder().decode(first), '{"a":[3,2],"b":1}');
});

test("round trip preserves every document and CRC", () => {
  const { manifest, docs } = shippableDocuments();
  const built = buildKitPackage(manifest, docs);
  assert.equal(built.entryCount, 7);
  const entries = parseKitPackage(built.zip);
  assert.equal(entries.length, 7);
  for (const entry of entries) {
    assert.deepEqual(entry.data, docs[entry.path]);
    assert.equal(entry.crc32, crc32Bytes(docs[entry.path]));
  }
  const stored = entries.find((entry) => entry.path === "manifest.json");
  assert.deepEqual(stored?.data, docs["manifest.json"]);
  assert.equal(built.sha256, sha256HexBytes(built.zip));
});

test("rebuilds are byte-identical", () => {
  const first = buildKitPackage(shippableDocuments().manifest, shippableDocuments().docs);
  const { manifest, docs } = shippableDocuments();
  const second = buildKitPackage(manifest, docs);
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.zip, second.zip);
});

test("archive order follows sorted paths", () => {
  const { manifest, docs } = shippableDocuments();
  const entries = parseKitPackage(buildKitPackage(manifest, docs).zip);
  const paths = entries.map((entry) => entry.path);
  assert.deepEqual(paths, [...paths].sort());
});

test("withheld bytes are excluded from the archive", () => {
  const { manifest, docs } = shippableDocuments(false);
  const entries = parseKitPackage(buildKitPackage(manifest, docs).zip);
  assert.ok(!entries.some((entry) => entry.path === "starter/app/page.tsx"));
});

test("supplying withheld bytes fails closed", () => {
  const { manifest, docs } = shippableDocuments(true);
  assert.throws(() => buildKitPackage(manifest, docs), KitPackageError);
});

test("missing, extra, and mismatched documents fail closed", () => {
  const { manifest, docs } = shippableDocuments();
  const missing = { ...docs };
  delete missing["lens.json"];
  assert.throws(() => buildKitPackage(manifest, missing), KitPackageError);
  assert.throws(() => buildKitPackage(manifest, { ...docs, "evil.txt": payload("x") }), KitPackageError);
  const tampered = { ...docs, "lens.json": payload("LENS") };
  assert.throws(() => buildKitPackage(manifest, tampered), KitPackageError);
});

test("payloads over the scope byte budget fail closed", () => {
  const { manifest, docs } = shippableDocuments();
  const tight = { ...manifest, capture_scope: { ...manifest.capture_scope, max_bytes: 10 } };
  assert.throws(() => buildKitPackage(tight, docs), KitPackageError);
});

test("a manifest with nothing shippable cannot package", () => {
  const req = {
    kitId: HEX_A, analysisId: HEX_B, status: "failed",
    report: { analysisId: HEX_B, sha256: HEX_C },
    scope: { mode: "single-page", maxPages: 1, maxDepth: 0, maxBytes: 1000000, timeBudgetMs: 60000 },
    pages: [{ url: "https://example.org/", sha256: HEX_A, viewport: "desktop" }],
    artifacts: fixedArtifacts().map((entry) => ({ ...entry, classification: "unknown" })),
    provenance: { observed: [], deterministic: [], coverageGaps: ["all-withheld"] },
  };
  const manifest = assembleKitManifest(req);
  assert.throws(() => buildKitPackage(manifest, {}), KitPackageError);
});

test("corrupt and truncated archives fail closed on parse", () => {
  const { manifest, docs } = shippableDocuments();
  const { zip } = buildKitPackage(manifest, docs);
  const flipped = zip.slice();
  // Offset 40 sits inside the first entry's stored file data ("AGENT.md"
  // header is 30 + 8 name bytes, then 5 data bytes), so this must trip CRC.
  flipped[40] = flipped[40] ^ 0xff;
  assert.throws(() => parseKitPackage(flipped), KitPackageError);
  assert.throws(() => parseKitPackage(zip.slice(0, 40)), KitPackageError);
  assert.throws(() => parseKitPackage(payload("not a zip at all..............")), KitPackageError);
});

test("self digest is stable and tampering with it fails closed", () => {
  const { manifest, manifestDoc } = selfConsistentManifest();
  const record = manifest.artifacts.find((entry) => entry.path === "manifest.json");
  assert.equal(record?.sha256, manifestSelfDigest(manifest));
  assert.equal(record?.bytes, manifestDoc.byteLength);
  const tampered = structuredClone(manifest);
  const tamperedRecord = tampered.artifacts.find((entry) => entry.path === "manifest.json");
  tamperedRecord.sha256 = HEX_B;
  const { docs } = shippableDocuments();
  assert.throws(() => buildKitPackage(tampered, { ...docs, "manifest.json": manifestDoc }), KitPackageError);
  const swapped = structuredClone(manifest);
  assert.equal(manifestSelfDigest(swapped), manifestSelfDigest(manifest));
});

test("unsupported methods and unsafe paths fail closed on parse", () => {
  const { manifest, docs } = shippableDocuments();
  const { zip } = buildKitPackage(manifest, docs);
  const deflated = zip.slice();
  // First central entry starts right after the 7 local entries; patch its
  // method field (central offset +10) to deflate (8).
  let cursor = 0;
  for (let i = 0; i < 7; i += 1) {
    const nameLen = deflated[cursor + 26] | (deflated[cursor + 27] << 8);
    const dataLen = deflated[cursor + 18] | (deflated[cursor + 19] << 8) | (deflated[cursor + 20] << 16) | (deflated[cursor + 21] << 24);
    cursor += 30 + nameLen + dataLen;
  }
  deflated[cursor + 10] = 8;
  assert.throws(() => parseKitPackage(deflated), KitPackageError);
  const traversal = zip.slice();
  // "AGENT.md" is 8 bytes in both headers; overwrite with "../evil!".
  const evil = new TextEncoder().encode("../evil!");
  traversal.set(evil, 30);
  traversal.set(evil, cursor + 46);
  assert.throws(() => parseKitPackage(traversal), KitPackageError);
});

test("central directory stays authoritative over local names", () => {
  const { manifest, docs } = shippableDocuments();
  const { zip } = buildKitPackage(manifest, docs);
  const renamed = zip.slice();
  renamed.set(new TextEncoder().encode("AGENT.m_"), 30);
  const entries = parseKitPackage(renamed);
  assert.equal(entries[0]?.path, "AGENT.md");
  assert.deepEqual(entries[0]?.data, docs["AGENT.md"]);
});

test("malformed build input fails closed", () => {
  const { manifest, docs } = shippableDocuments();
  assert.throws(() => buildKitPackage(null, docs), KitPackageError);
  assert.throws(() => buildKitPackage(manifest, null), KitPackageError);
  assert.throws(() => buildKitPackage(manifest, { ...docs, "lens.json": "text" }), KitPackageError);
});
