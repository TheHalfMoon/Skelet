import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../../scripts/check_abuse_alarms.mjs", import.meta.url));
const NOW = 1_700_000_000_000;

function run(args, input) {
  const dir = mkdtempSync(join(tmpdir(), "skilit-p15-2-"));
  try {
    const eventsPath = join(dir, "events.jsonl");
    writeFileSync(eventsPath, input);
    const argv = [process.execPath, "--experimental-strip-types", SCRIPT, "--events", eventsPath, ...args];
    // execFileSync with shell:false; argv[0] is node, argv[1] is the flag.
    const stdout = execFileSync(argv[0], argv.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { exit: 0, stdout };
  } catch (error) {
    return {
      exit: typeof error.status === "number" ? error.status : -1,
      stdout: typeof error.stdout === "string" ? error.stdout : "",
      stderr: typeof error.stderr === "string" ? error.stderr : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function event(code, at, workspaceId) {
  const entry = { code, at };
  if (workspaceId !== undefined) entry.workspaceId = workspaceId;
  return JSON.stringify(entry);
}

test("P15-2: quiet streams exit 0 with an ok assessment", () => {
  const input = `${event("FORBIDDEN_OR_NOT_FOUND", NOW - 1000, "ws-01")}\n`;
  const result = run(["--now", String(NOW)], input);
  assert.equal(result.exit, 0);
  const assessment = JSON.parse(result.stdout);
  assert.equal(assessment.level, "ok");
  assert.deepEqual(assessment.alarms, []);
});

test("P15-2: forbidden spikes exit 1 elevated and 2 critical", () => {
  const elevated = Array.from({ length: 50 }, (_, index) => event("FORBIDDEN_OR_NOT_FOUND", NOW - index * 1000)).join("\n");
  const first = run(["--now", String(NOW)], `${elevated}\n`);
  assert.equal(first.exit, 1);
  assert.equal(JSON.parse(first.stdout).level, "elevated");
  const critical = Array.from({ length: 200 }, (_, index) => event("FORBIDDEN_OR_NOT_FOUND", NOW - index * 1000)).join("\n");
  const second = run(["--now", String(NOW)], `${critical}\n`);
  assert.equal(second.exit, 2);
  assert.equal(JSON.parse(second.stdout).level, "critical");
});

test("P15-2: quota bursts attribute the workspace and stuck jobs escalate", () => {
  const burst = Array.from({ length: 5 }, (_, index) => event("QUOTA_EXCEEDED", NOW - index * 1000, "ws-09")).join("\n");
  const result = run(["--now", String(NOW)], `${burst}\n`);
  assert.equal(result.exit, 1);
  const assessment = JSON.parse(result.stdout);
  assert.equal(assessment.alarms[0].rule, "quota-burst");
  assert.ok(assessment.alarms[0].detail.includes("ws-09"));
  const stuck = run(["--now", String(NOW), "--stuck-jobs", "3"], "\n");
  assert.equal(stuck.exit, 1);
  assert.equal(JSON.parse(stuck.stdout).alarms[0].rule, "stuck-jobs");
});

test("P15-2: malformed inputs fail closed with exit 3 and no assessment", () => {
  const badJson = run(["--now", String(NOW)], "this is not json\n");
  assert.equal(badJson.exit, 3);
  assert.equal(badJson.stdout, "");
  const badEvent = run(["--now", String(NOW)], `${JSON.stringify({ code: "", at: NOW })}\n`);
  assert.equal(badEvent.exit, 3);
  const dir = mkdtempSync(join(tmpdir(), "skilit-p15-2-"));
  try {
    const missing = join(dir, "does-not-exist.jsonl");
    try {
      execFileSync(process.execPath, ["--experimental-strip-types", SCRIPT, "--events", missing, "--now", String(NOW)], { encoding: "utf8" });
      assert.fail("missing file must fail");
    } catch (error) {
      assert.equal(error.status, 3);
    }
    try {
      execFileSync(process.execPath, ["--experimental-strip-types", SCRIPT, "--now", String(NOW)], { encoding: "utf8" });
      assert.fail("missing --events must fail");
    } catch (error) {
      assert.equal(error.status, 3);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("P15-2: over-budget files fail closed without evaluation", () => {
  const bigLine = `{"code":"${"x".repeat(65 * 1024)}","at":${NOW}}\n`;
  const result = run(["--now", String(NOW)], bigLine);
  assert.equal(result.exit, 3);
  assert.equal(result.stdout, "");
});
