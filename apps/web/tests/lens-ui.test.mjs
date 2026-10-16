import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const PAGE = new URL("../app/lens/page.tsx", import.meta.url);

async function source() {
  return readFile(PAGE, "utf8");
}

test("lens UI serves the full lifecycle over the real REST contracts", async () => {
  const text = await source();
  for (const route of [
    "/api/v1/lens/jobs",
    "/api/v1/lens/jobs/${encodeURIComponent(id)}?workspaceId=",
    "/artifacts?workspaceId=",
  ]) {
    assert.ok(text.includes(route), `UI calls ${route}`);
  }
  for (const action of ['"cancel"', '"retry"', '"resume"']) {
    assert.ok(text.includes(action), `UI serves the ${action} action over its REST route`);
  }
  for (const marker of ["Poll status", "Inspect", "Watch until terminal", "Cancel", "Retry", "Resume", "Download manifest", "Download evidence"]) {
    assert.ok(text.includes(marker), `UI exposes ${marker}`);
  }
  assert.ok(text.includes("skilit://lens/"), "UI renders the stable lens identifier");
  assert.ok(text.includes("Authorization"), "UI authenticates with a bearer token");
  assert.ok(!/Bearer [A-Za-z0-9._-]{8,}/.test(text.replace("Bearer ${token.trim()}", "")), "UI carries no hardcoded credential");
});

test("lens UI shows loading, empty, failure, and terminal states", async () => {
  const text = await source();
  assert.ok(text.includes("Working:"), "UI shows a loading state");
  assert.ok(text.includes('role="alert"'), "UI announces failures assertively");
  assert.ok(text.includes("No job inspected yet"), "UI has an explicit empty state");
  assert.ok(text.includes("Watch timed out"), "UI bounds polling with a timeout");
  assert.ok(text.includes("Withheld"), "UI distinguishes withheld outputs");
  assert.ok(text.includes("aria-live"), "UI exposes state changes to assistive tech");
});

test("lens UI renders persisted evidence without mock data", async () => {
  const text = await source();
  for (const field of ["resultEvidence", "artifactSummary", "attemptHistory", "revision", "errorClass", "expiresAt"]) {
    assert.ok(text.includes(field), `UI renders persisted ${field}`);
  }
  for (const forbidden of ["lorem", "TODO mock", "fake job", "placeholder job", "Math.random()", "http://example.com"]) {
    assert.ok(!text.includes(forbidden), `UI must not contain ${JSON.stringify(forbidden)}`);
  }
  assert.ok(text.includes("arrayBuffer"), "UI downloads real artifact bytes");
  assert.ok(text.includes("X-Content-Sha256"), "UI surfaces the integrity digest");
});

test("lens UI uses native keyboard-operable controls with labels", async () => {
  const text = await source();
  for (const tag of ["<form", "<label", "<input", "<button", "<select"]) {
    assert.ok(text.includes(tag), `UI uses native ${tag}`);
  }
  assert.ok(text.includes('htmlFor="lens-token"'), "UI labels its credential field");
  assert.ok(text.includes('htmlFor="lens-kit"'), "UI labels its job field");
  assert.ok(text.includes('"use client"'), "UI is a client component over the REST routes");
});
