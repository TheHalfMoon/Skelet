import assert from "node:assert/strict";
import test from "node:test";

import { run } from "../src/cli.ts";

test("health command reports the worker contract", () => {
  const result = run(["health"], {});
  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "ok");
  assert.equal(payload.service, "skelet-worker");
  assert.equal(typeof payload.version, "string");
  assert.ok(payload.version.length > 0);
  assert.equal(payload.env, "development");
});

test("health fails closed on invalid env", () => {
  const result = run(["health"], { SKELET_ENV: "staging" });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /SKELET_ENV/);
});

test("start command validates env and reports readiness", () => {
  const result = run(["start"], { SKELET_ENV: "test" });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /ready/);
  assert.match(result.stdout, /no jobs registered/);
});

test("start fails closed on invalid env", () => {
  const result = run(["start"], { SKELET_ENV: "staging" });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /SKELET_ENV/);
});

test("unknown command prints usage with exit 2", () => {
  const result = run(["frobnicate"], {});
  assert.equal(result.exitCode, 2);
  assert.match(result.stdout, /usage/i);
});

test("missing command prints usage with exit 2", () => {
  const result = run([], {});
  assert.equal(result.exitCode, 2);
});
