import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const PAGE = new URL("../app/flows/page.tsx", import.meta.url);

async function source() {
  return readFile(PAGE, "utf8");
}

test("flow player serves flow and step reads over the real REST contracts", async () => {
  const text = await source();
  for (const route of [
    "/api/v1/flows?",
    "/api/v1/flows/${encodeURIComponent(flowIdOf(id))}/steps",
  ]) {
    assert.ok(text.includes(route), `UI calls ${route}`);
  }
  for (const marker of ["List flows", "Inspect steps", "More flows", "Previous step", "Next step"]) {
    assert.ok(text.includes(marker), `UI exposes ${marker}`);
  }
  assert.ok(text.includes("skilit://flow/"), "UI renders the stable flow identifier");
  assert.ok(text.includes("skilit://artifact/") || text.includes("current.uri"), "UI renders step artifact references");
  assert.ok(text.includes("Authorization"), "UI authenticates with a bearer token");
  assert.ok(!/Bearer [A-Za-z0-9._-]{8,}/.test(text.replace("Bearer ${token.trim()}", "")), "UI carries no hardcoded credential");
});

test("flow player shows loading, empty, failure, and ordered states", async () => {
  const text = await source();
  assert.ok(text.includes("Working:"), "UI shows a loading state");
  assert.ok(text.includes('role="alert"'), "UI announces failures assertively");
  assert.ok(text.includes("No flows listed yet"), "UI has an explicit unlisted state");
  assert.ok(text.includes("No flows in this scope"), "UI has an explicit empty-scope state");
  assert.ok(text.includes("No steps listed yet"), "UI has an explicit unlisted steps state");
  assert.ok(text.includes("No steps in this flow"), "UI has an explicit empty-steps state");
  assert.ok(text.includes("deterministic order"), "UI documents deterministic step ordering");
  assert.ok(text.includes("aria-live"), "UI exposes state changes to assistive tech");
});

test("flow player renders persisted step fields without fabricating interactions", async () => {
  const text = await source();
  for (const field of ["stepCount", "position", "kind", "interaction"]) {
    assert.ok(text.includes(field), `UI renders persisted ${field}`);
  }
  assert.ok(text.includes("never"), "UI states interactions are never fabricated");
  assert.ok(text.includes("none recorded"), "UI marks missing interactions explicitly");
  for (const forbidden of ["lorem", "TODO mock", "fake flow", "placeholder flow", "Math.random()", "http://example.com"]) {
    assert.ok(!text.includes(forbidden), `UI must not contain ${JSON.stringify(forbidden)}`);
  }
});

test("flow player uses native keyboard-operable controls with labels", async () => {
  const text = await source();
  for (const tag of ["<form", "<label", "<input", "<button", "<ol", "<article"]) {
    assert.ok(text.includes(tag), `UI uses native ${tag}`);
  }
  assert.ok(text.includes('htmlFor="flows-token"'), "UI labels its credential field");
  assert.ok(text.includes('htmlFor="flows-version"'), "UI labels its version filter");
  assert.ok(text.includes('htmlFor="flows-id"'), "UI labels its flow field");
  assert.ok(text.includes('"use client"'), "UI is a client component over the REST routes");
  assert.ok(text.includes("disabled={at <="), "UI bounds previous-step navigation");
});

test("flow player documents the replay boundary", async () => {
  const text = await source();
  assert.ok(text.includes("record.cursor"), "UI reads the top-level envelope cursor");
  assert.ok(!text.includes("record.pagination"), "UI does not invent a pagination nest");
  assert.ok(text.includes("rrweb"), "UI names the follow-on replay surface");
});

test("flow player inspects consented replay sessions in recorded order", async () => {
  const text = await source();
  for (const route of ["/api/v1/replays/${encodeURIComponent(id)}/events"]) {
    assert.ok(text.includes(route), `UI calls ${route}`);
  }
  for (const marker of ["Inspect replay", "Previous event", "Next event", "No replay inspected yet"]) {
    assert.ok(text.includes(marker), `UI exposes ${marker}`);
  }
  assert.ok(text.includes("masked before storage"), "UI documents pre-storage masking");
  assert.ok(text.includes('htmlFor="flows-replay"'), "UI labels its replay field");
});
