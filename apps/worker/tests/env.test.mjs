import assert from "node:assert/strict";
import test from "node:test";

import { loadEnv } from "../src/env.ts";

test("loadEnv applies documented defaults", () => {
  const env = loadEnv({});
  assert.equal(env.SKELET_ENV, "development");
  assert.equal(env.SKELET_WORKER_CONCURRENCY, 4);
  assert.equal(env.SKELET_LOG_LEVEL, "info");
});

test("loadEnv accepts valid overrides", () => {
  const env = loadEnv({
    SKELET_ENV: "production",
    SKELET_WORKER_CONCURRENCY: "8",
    SKELET_LOG_LEVEL: "warn",
  });
  assert.equal(env.SKELET_ENV, "production");
  assert.equal(env.SKELET_WORKER_CONCURRENCY, 8);
  assert.equal(env.SKELET_LOG_LEVEL, "warn");
});

test("loadEnv rejects invalid values", () => {
  assert.throws(() => loadEnv({ SKELET_ENV: "staging" }), /SKELET_ENV/);
  assert.throws(
    () => loadEnv({ SKELET_WORKER_CONCURRENCY: "0" }),
    /SKELET_WORKER_CONCURRENCY/,
  );
  assert.throws(
    () => loadEnv({ SKELET_WORKER_CONCURRENCY: "many" }),
    /SKELET_WORKER_CONCURRENCY/,
  );
  assert.throws(() => loadEnv({ SKELET_LOG_LEVEL: "verbose" }), /SKELET_LOG_LEVEL/);
});

test("loadEnv enforces concurrency boundaries strictly", () => {
  assert.equal(loadEnv({ SKELET_WORKER_CONCURRENCY: "1" }).SKELET_WORKER_CONCURRENCY, 1);
  assert.equal(loadEnv({ SKELET_WORKER_CONCURRENCY: "32" }).SKELET_WORKER_CONCURRENCY, 32);
  for (const bad of ["0", "33", "1.5", "", "0x8", "1e1", " 8 ", "08x"]) {
    assert.throws(
      () => loadEnv({ SKELET_WORKER_CONCURRENCY: bad }),
      /SKELET_WORKER_CONCURRENCY/,
      `expected rejection for ${JSON.stringify(bad)}`,
    );
  }
});

test("loadEnv rejects unknown SKELET_ keys", () => {
  assert.throws(() => loadEnv({ SKELET_TYPO_VAR: "1" }), /SKELET_TYPO_VAR/);
});

test("loadEnv ignores non-Skelet keys", () => {
  const env = loadEnv({ PATH: "/usr/bin", HOME: "/root" });
  assert.equal(env.SKELET_ENV, "development");
});
