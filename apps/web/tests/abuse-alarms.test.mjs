import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAbuseAlarms } from "../lib/abuse-alarms.ts";

const NOW = 1_700_000_000_000;

function event(code, at, workspaceId) {
  const entry = { code, at };
  if (workspaceId !== undefined) entry.workspaceId = workspaceId;
  return entry;
}

test("P15-1: quiet streams assess ok with no action", async () => {
  const assessment = evaluateAbuseAlarms(
    [event("FORBIDDEN_OR_NOT_FOUND", NOW - 1000, "ws-01"), event("RATE_LIMITED", NOW - 1000, "ws-01")],
    { now: NOW },
  );
  assert.equal(assessment.level, "ok");
  assert.deepEqual(assessment.alarms, []);
  assert.equal(assessment.recommendedAction, "No action required.");
  assert.deepEqual(evaluateAbuseAlarms([], { now: NOW }), assessment);
});

test("P15-1: forbidden spikes escalate at documented thresholds", async () => {
  const elevated = Array.from({ length: 50 }, (_, index) => event("FORBIDDEN_OR_NOT_FOUND", NOW - index * 1000));
  const first = evaluateAbuseAlarms(elevated, { now: NOW });
  assert.equal(first.level, "elevated");
  assert.equal(first.alarms[0].rule, "forbidden-spike");
  const critical = Array.from({ length: 200 }, (_, index) => event("FORBIDDEN_OR_NOT_FOUND", NOW - index * 1000));
  const second = evaluateAbuseAlarms(critical, { now: NOW });
  assert.equal(second.level, "critical");
  assert.ok(second.recommendedAction.includes("incident"));
  const stale = Array.from({ length: 200 }, () => event("FORBIDDEN_OR_NOT_FOUND", NOW - 10 * 60_000));
  assert.equal(evaluateAbuseAlarms(stale, { now: NOW }).level, "ok");
});

test("P15-1: quota bursts attribute the workspace", async () => {
  const burst = Array.from({ length: 5 }, (_, index) => event("QUOTA_EXCEEDED", NOW - index * 1000, "ws-07"));
  const assessment = evaluateAbuseAlarms(
    [...burst, ...Array.from({ length: 4 }, (_, index) => event("QUOTA_EXCEEDED", NOW - index * 1000, "ws-08"))],
    { now: NOW },
  );
  assert.equal(assessment.level, "elevated");
  assert.ok(assessment.alarms.some((alarm) => alarm.rule === "quota-burst" && alarm.detail.includes("ws-07")));
  assert.ok(!assessment.alarms.some((alarm) => alarm.detail.includes("ws-08")));
  const critical = Array.from({ length: 20 }, (_, index) => event("QUOTA_EXCEEDED", NOW - index * 1000, "ws-07"));
  assert.equal(evaluateAbuseAlarms(critical, { now: NOW }).level, "critical");
});

test("P15-1: sustained rate denials and stuck jobs alarm elevated", async () => {
  const limited = Array.from({ length: 100 }, (_, index) => event("RATE_LIMITED", NOW - index * 500));
  const first = evaluateAbuseAlarms(limited, { now: NOW });
  assert.equal(first.level, "elevated");
  assert.ok(first.alarms.some((alarm) => alarm.rule === "rate-sustained"));
  assert.equal(evaluateAbuseAlarms([], { now: NOW, stuckJobs: 3 }).level, "elevated");
  assert.equal(evaluateAbuseAlarms([], { now: NOW, stuckJobs: 2 }).level, "ok");
});

test("P15-1: assessment is deterministic and leaks no payload", async () => {
  const events = [event("FORBIDDEN_OR_NOT_FOUND", NOW - 1000, "ws-01")];
  assert.deepEqual(evaluateAbuseAlarms(events, { now: NOW }), evaluateAbuseAlarms(events, { now: NOW }));
  const text = JSON.stringify(evaluateAbuseAlarms(events, { now: NOW }));
  for (const leaked of ["password", "secret", "token", "BEGIN PRIVATE", "stack"]) {
    assert.ok(!text.toLowerCase().includes(leaked), `must not leak ${leaked}`);
  }
});

test("P15-1: malformed streams and counts fail closed", async () => {
  for (const bad of [null, "events", [{ code: "", at: NOW }], [{ code: "X", at: -1 }], [{ code: "X", at: NOW, workspaceId: "" }]]) {
    assert.throws(() => evaluateAbuseAlarms(bad, { now: NOW }), /Abuse alarm input is invalid/);
  }
  assert.throws(() => evaluateAbuseAlarms([], { now: NOW, stuckJobs: -1 }), /Abuse alarm input is invalid/);
  assert.throws(() => evaluateAbuseAlarms([], { now: -1 }), /Abuse alarm input is invalid/);
});
