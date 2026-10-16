/**
 * P15-2 operator abuse-alarm CLI (Skelet-owned, no-prod-dependency).
 *
 * Implements the manual abuse-triage procedure in
 * `docs/operations/RUNBOOK.md` section 4 as an executable operator
 * command: reads a JSONL event file (one JSON object per line with
 * `code`, `at`, and optional `workspaceId`), evaluates it with the
 * committed `evaluateAbuseAlarms` thresholds from `docs/operations/SLOS.md`,
 * prints the deterministic assessment as JSON, and exits with a
 * machine-readable status code.
 *
 * Usage:
 *   node --experimental-strip-types scripts/check_abuse_alarms.mjs --events <file.jsonl> [--stuck-jobs N] [--now ms]
 *
 * Exit codes: 0 ok, 1 elevated, 2 critical, 3 invalid input.
 * No network, no model, no hosted dashboard. Managed alerting stays
 * deferred; this CLI is the local operator path, not a hosted monitor.
 */

import { readFile } from "node:fs/promises";

import { evaluateAbuseAlarms } from "../apps/web/lib/abuse-alarms.ts";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_LINES = 100_000;
const MAX_LINE_BYTES = 64 * 1024;

function usage() {
  return [
    "Usage:",
    "  node --experimental-strip-types scripts/check_abuse_alarms.mjs --events <file.jsonl> [--stuck-jobs N] [--now ms]",
    "",
    "Exit codes: 0 ok, 1 elevated, 2 critical, 3 invalid input.",
  ].join("\n");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function fail(message) {
  process.stderr.write(`check_abuse_alarms: ${message}\n${usage()}\n`);
  process.exit(3);
}

function parseStuckJobs(raw) {
  if (raw === undefined) return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    fail("stuck-job count is invalid.");
  }
  return value;
}

function parseNow(raw) {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    fail("reference time is invalid.");
  }
  return value;
}

function parseEventsJsonl(text) {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  const events = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      fail("event file carries an over-budget line.");
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      fail("event file is not valid JSONL.");
    }
    events.push(parsed);
    if (events.length > MAX_LINES) {
      fail("event file exceeds its line budget.");
    }
  }
  return events;
}

const eventsPath = argValue("--events");
if (eventsPath === undefined || eventsPath === "") {
  fail("the --events file is required.");
}

let text;
try {
  const data = await readFile(eventsPath);
  if (data.length === 0 || data.length > MAX_FILE_BYTES) {
    fail("event file exceeds its byte budget.");
  }
  text = data.toString("utf8");
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    fail("event file is unavailable.");
  }
  fail("event file cannot be read.");
}

const stuckJobs = parseStuckJobs(argValue("--stuck-jobs"));
const now = parseNow(argValue("--now"));
const events = parseEventsJsonl(text);

let assessment;
try {
  assessment = evaluateAbuseAlarms(events, { now, stuckJobs });
} catch (error) {
  fail(error instanceof Error ? error.message : "event stream is invalid.");
}

process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`);
process.exit(assessment.level === "critical" ? 2 : assessment.level === "elevated" ? 1 : 0);
