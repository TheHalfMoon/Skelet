import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const PAGE = new URL("../app/patterns/page.tsx", import.meta.url);

async function source() {
  return readFile(PAGE, "utf8");
}

test("pattern taxonomy UI serves reads over the real REST contracts", async () => {
  const text = await source();
  for (const route of [
    "/api/v1/patterns?",
    "/api/v1/patterns/${encodeURIComponent(slugOf(value))}",
  ]) {
    assert.ok(text.includes(route), `UI calls ${route}`);
  }
  for (const marker of ["List patterns", "Inspect pattern", "More patterns"]) {
    assert.ok(text.includes(marker), `UI exposes ${marker}`);
  }
  assert.ok(text.includes("skilit://pattern/"), "UI renders the stable pattern identifier");
  assert.ok(text.includes("Authorization"), "UI authenticates with a bearer token");
  assert.ok(!/Bearer [A-Za-z0-9._-]{8,}/.test(text.replace("Bearer ${token.trim()}", "")), "UI carries no hardcoded credential");
});

test("pattern taxonomy UI shows loading, empty, failure, and filtered states", async () => {
  const text = await source();
  assert.ok(text.includes("Working:"), "UI shows a loading state");
  assert.ok(text.includes('role="alert"'), "UI announces failures assertively");
  assert.ok(text.includes("No patterns listed yet"), "UI has an explicit unlisted state");
  assert.ok(text.includes("No patterns in this scope"), "UI has an explicit empty-scope state");
  assert.ok(text.includes("No pattern inspected yet"), "UI has an explicit uninspected state");
  assert.ok(text.includes("No description recorded"), "UI marks missing descriptions explicitly");
  assert.ok(text.includes("aria-live"), "UI exposes state changes to assistive tech");
});

test("pattern taxonomy UI renders persisted links without mock data", async () => {
  const text = await source();
  for (const field of ["artifactCount", "relation", "kind", "description"]) {
    assert.ok(text.includes(field), `UI renders persisted ${field}`);
  }
  for (const forbidden of ["lorem", "TODO mock", "fake pattern", "placeholder pattern", "Math.random()", "http://example.com"]) {
    assert.ok(!text.includes(forbidden), `UI must not contain ${JSON.stringify(forbidden)}`);
  }
  assert.ok(text.includes("unknown slugs read as not found"), "UI documents the no-oracle contract");
});

test("pattern taxonomy UI uses native keyboard-operable controls with labels", async () => {
  const text = await source();
  for (const tag of ["<form", "<label", "<input", "<button", "<ol", "<ul", "<article"]) {
    assert.ok(text.includes(tag), `UI uses native ${tag}`);
  }
  assert.ok(text.includes('htmlFor="patterns-token"'), "UI labels its credential field");
  assert.ok(text.includes('htmlFor="patterns-query"'), "UI labels its filter field");
  assert.ok(text.includes('htmlFor="patterns-slug"'), "UI labels its slug field");
  assert.ok(text.includes('"use client"'), "UI is a client component over the REST routes");
});

test("pattern taxonomy UI documents the capture boundary", async () => {
  const text = await source();
  assert.ok(text.includes("record.cursor"), "UI reads the top-level envelope cursor");
  assert.ok(!text.includes("record.pagination"), "UI does not invent a pagination nest");
  assert.ok(text.includes("rrweb"), "UI names the follow-on replay surface");
});
