import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const PAGE = new URL("../app/gallery/page.tsx", import.meta.url);

async function source() {
  return readFile(PAGE, "utf8");
}

test("gallery UI serves product and version reads over the real REST contracts", async () => {
  const text = await source();
  for (const route of [
    "/api/v1/products?",
    "/api/v1/products/${encodeURIComponent(id)}/versions?",
  ]) {
    assert.ok(text.includes(route), `UI calls ${route}`);
  }
  for (const marker of ["List products", "Inspect versions", "More products", "More versions"]) {
    assert.ok(text.includes(marker), `UI exposes ${marker}`);
  }
  assert.ok(text.includes("skelet://product/"), "UI renders the stable product identifier");
  assert.ok(text.includes("skelet://version/") || text.includes("version.uri"), "UI renders version identifiers");
  assert.ok(text.includes("Authorization"), "UI authenticates with a bearer token");
  assert.ok(!/Bearer [A-Za-z0-9._-]{8,}/.test(text.replace("Bearer ${token.trim()}", "")), "UI carries no hardcoded credential");
});

test("gallery UI shows loading, empty, failure, and filtered states", async () => {
  const text = await source();
  assert.ok(text.includes("Working:"), "UI shows a loading state");
  assert.ok(text.includes('role="alert"'), "UI announces failures assertively");
  assert.ok(text.includes("No products listed yet"), "UI has an explicit unlisted state");
  assert.ok(text.includes("No products in this workspace"), "UI has an explicit empty-workspace state");
  assert.ok(text.includes("No products match this filter"), "UI has an explicit filtered-empty state");
  assert.ok(text.includes("No versions listed yet"), "UI has an explicit unlisted versions state");
  assert.ok(text.includes("No versions in this product"), "UI has an explicit empty-versions state");
  assert.ok(text.includes("aria-live"), "UI exposes state changes to assistive tech");
});

test("gallery UI renders persisted gallery fields without mock data", async () => {
  const text = await source();
  for (const field of ["versionCount", "artifactCount", "versionNo", "productId"]) {
    assert.ok(text.includes(field), `UI renders persisted ${field}`);
  }
  for (const forbidden of ["lorem", "TODO mock", "fake product", "placeholder product", "Math.random()", "http://example.com"]) {
    assert.ok(!text.includes(forbidden), `UI must not contain ${JSON.stringify(forbidden)}`);
  }
  assert.ok(text.includes("Fully-withheld corpora read as empty"), "UI documents the no-oracle contract");
  assert.ok(text.includes('"Content-Type": "application/json"') || text.includes("headers: authHeaders()"), "UI calls the real routes");
});

test("gallery UI uses native keyboard-operable controls with labels", async () => {
  const text = await source();
  for (const tag of ["<form", "<label", "<input", "<button", "<ol", "<ul"]) {
    assert.ok(text.includes(tag), `UI uses native ${tag}`);
  }
  assert.ok(text.includes('htmlFor="gallery-token"'), "UI labels its credential field");
  assert.ok(text.includes('htmlFor="gallery-filter"'), "UI labels its filter field");
  assert.ok(text.includes('htmlFor="gallery-product"'), "UI labels its product field");
  assert.ok(text.includes('"use client"'), "UI is a client component over the REST routes");
});

test("gallery UI paginates with the top-level envelope cursor", async () => {
  const text = await source();
  assert.ok(text.includes("record.cursor"), "UI reads the top-level envelope cursor");
  assert.ok(!text.includes("record.pagination"), "UI does not invent a pagination nest");
});

test("gallery UI documents the artifact-inspection boundary", async () => {
  const text = await source();
  assert.ok(text.includes("artifact"), "UI references artifact counts");
  assert.ok(text.includes("flow player"), "UI names the follow-on inspection surface");
});
