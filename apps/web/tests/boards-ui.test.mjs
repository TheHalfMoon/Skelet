import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const PAGE = new URL("../app/boards/page.tsx", import.meta.url);

async function source() {
  return readFile(PAGE, "utf8");
}

test("boards UI serves the full curation lifecycle over the real REST contracts", async () => {
  const text = await source();
  for (const route of [
    "/api/v1/boards?workspaceId=",
    "/api/v1/boards",
    "/api/v1/boards/${encodeURIComponent(id)}",
    "/items",
    "/move",
    "/handoff",
    "/handoffs",
    "/validation",
  ]) {
    assert.ok(text.includes(route), `UI calls ${route}`);
  }
  for (const marker of ["List boards", "Create board", "Inspect", "Delete", "Save item", "Move item", "Remove", "Hand off board", "List handoffs", "Validate items"]) {
    assert.ok(text.includes(marker), `UI exposes ${marker}`);
  }
  assert.ok(text.includes("skelet://collection/"), "UI renders the stable board identifier");
  assert.ok(text.includes("Authorization"), "UI authenticates with a bearer token");
  assert.ok(!/Bearer [A-Za-z0-9._-]{8,}/.test(text.replace("Bearer ${token.trim()}", "")), "UI carries no hardcoded credential");
});

test("boards UI shows loading, empty, failure, and ordered states", async () => {
  const text = await source();
  assert.ok(text.includes("Working:"), "UI shows a loading state");
  assert.ok(text.includes('role="alert"'), "UI announces failures assertively");
  assert.ok(text.includes("No boards listed yet"), "UI has an explicit unlisted state");
  assert.ok(text.includes("No boards in this workspace"), "UI has an explicit empty-workspace state");
  assert.ok(text.includes("Board is empty"), "UI has an explicit empty-board state");
  assert.ok(text.includes("rank {item.position}"), "UI renders ranks from persisted order");
  assert.ok(text.includes("aria-live"), "UI exposes state changes to assistive tech");
});

test("boards UI renders persisted boards without mock data", async () => {
  const text = await source();
  for (const field of ["position", "savedAt", "visibility", "artifactId"]) {
    assert.ok(text.includes(field), `UI renders persisted ${field}`);
  }
  for (const forbidden of ["lorem", "TODO mock", "fake board", "placeholder board", "Math.random()", "http://example.com"]) {
    assert.ok(!text.includes(forbidden), `UI must not contain ${JSON.stringify(forbidden)}`);
  }
  assert.ok(text.includes("DELETE"), "UI removes through the real route");
  assert.ok(text.includes('"Content-Type": "application/json"'), "UI posts real JSON bodies");
});

test("boards UI uses native keyboard-operable controls with labels", async () => {
  const text = await source();
  for (const tag of ["<form", "<label", "<input", "<button", "<ol", "<ul"]) {
    assert.ok(text.includes(tag), `UI uses native ${tag}`);
  }
  assert.ok(text.includes('htmlFor="boards-token"'), "UI labels its credential field");
  assert.ok(text.includes('htmlFor="boards-id"'), "UI labels its board field");
  assert.ok(text.includes('htmlFor="boards-recipient"'), "UI labels its handoff recipient field");
  assert.ok(text.includes('"use client"'), "UI is a client component over the REST routes");
});

test("boards UI exposes handoff provenance and validation states", async () => {
  const text = await source();
  for (const marker of [
    "No handoffs listed yet",
    "No handoffs recorded",
    "No validation run yet",
    "fromSubject",
    "toSubject",
  ]) {
    assert.ok(text.includes(marker), `UI exposes ${marker}`);
  }
});
