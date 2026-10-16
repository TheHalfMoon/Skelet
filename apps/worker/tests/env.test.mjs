import assert from "node:assert/strict";
import test from "node:test";

import { loadEnv } from "../src/env.ts";

test("loadEnv applies documented defaults", () => {
  const env = loadEnv({});
  assert.equal(env.SKILIT_ENV, "development");
  assert.equal(env.SKILIT_WORKER_CONCURRENCY, 4);
  assert.equal(env.SKILIT_LOG_LEVEL, "info");
  assert.equal(env.SKILIT_NO_MODEL, true);
});

test("loadEnv accepts valid overrides", () => {
  const env = loadEnv({
    SKILIT_ENV: "production",
    SKILIT_WORKER_CONCURRENCY: "8",
    SKILIT_LOG_LEVEL: "warn",
    SKILIT_NO_MODEL: "0",
  });
  assert.equal(env.SKILIT_ENV, "production");
  assert.equal(env.SKILIT_WORKER_CONCURRENCY, 8);
  assert.equal(env.SKILIT_LOG_LEVEL, "warn");
  assert.equal(env.SKILIT_NO_MODEL, false);
});

test("loadEnv accepts explicit strict flag", () => {
  assert.equal(loadEnv({ SKILIT_NO_MODEL: "1" }).SKILIT_NO_MODEL, true);
});

test("loadEnv rejects invalid values", () => {
  assert.throws(() => loadEnv({ SKILIT_ENV: "staging" }), /SKILIT_ENV/);
  assert.throws(
    () => loadEnv({ SKILIT_WORKER_CONCURRENCY: "0" }),
    /SKILIT_WORKER_CONCURRENCY/,
  );
  assert.throws(
    () => loadEnv({ SKILIT_WORKER_CONCURRENCY: "many" }),
    /SKILIT_WORKER_CONCURRENCY/,
  );
  assert.throws(() => loadEnv({ SKILIT_LOG_LEVEL: "verbose" }), /SKILIT_LOG_LEVEL/);
  assert.throws(() => loadEnv({ SKILIT_NO_MODEL: "strict" }), /SKILIT_NO_MODEL/);
  assert.throws(() => loadEnv({ SKILIT_NO_MODEL: "true" }), /SKILIT_NO_MODEL/);
  assert.throws(() => loadEnv({ SKILIT_NO_MODEL: "" }), /SKILIT_NO_MODEL/);
});

test("loadEnv enforces concurrency boundaries strictly", () => {
  assert.equal(loadEnv({ SKILIT_WORKER_CONCURRENCY: "1" }).SKILIT_WORKER_CONCURRENCY, 1);
  assert.equal(loadEnv({ SKILIT_WORKER_CONCURRENCY: "32" }).SKILIT_WORKER_CONCURRENCY, 32);
  for (const bad of ["0", "33", "1.5", "", "0x8", "1e1", " 8 ", "08x"]) {
    assert.throws(
      () => loadEnv({ SKILIT_WORKER_CONCURRENCY: bad }),
      /SKILIT_WORKER_CONCURRENCY/,
      `expected rejection for ${JSON.stringify(bad)}`,
    );
  }
});

test("loadEnv rejects unknown SKILIT_ keys", () => {
  assert.throws(() => loadEnv({ SKILIT_TYPO_VAR: "1" }), /SKILIT_TYPO_VAR/);
});

test("loadEnv ignores non-Skilit keys", () => {
  const env = loadEnv({ PATH: "/usr/bin", HOME: "/root" });
  assert.equal(env.SKILIT_ENV, "development");
});
