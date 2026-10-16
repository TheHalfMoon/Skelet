import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = dirname(require.resolve("../../package.json"));
const BENCH = join(repoRoot, "scripts", "bench_concurrent.mjs");

function finiteNumber(value, context) {
  assert.equal(typeof value, "number", `${context}: must be a number`);
  assert.ok(Number.isFinite(value), `${context}: must be finite`);
  assert.ok(value >= 0, `${context}: must be non-negative`);
}

test("P15 concurrent-load bench proves parallel search with a valid evidence schema", () => {
  const proc = spawnSync(
    process.execPath,
    ["--experimental-strip-types", BENCH, "--records", "30", "--concurrency", "4", "--iterations", "2"],
    { encoding: "utf8", timeout: 120000 },
  );
  assert.equal(proc.status, 0, `bench must exit zero (stderr: ${(proc.stderr ?? "").slice(0, 500)})`);
  const payload = JSON.parse(proc.stdout);
  assert.equal(payload.dataset, "synthetic-30-records");
  assert.equal(payload.engine, "pglite-embedded");
  assert.ok(typeof payload.note === "string" && payload.note.length > 0);
  assert.equal(payload.concurrency, 4);
  assert.equal(payload.iterations, 2);
  assert.equal(payload.totalRequests, 8);
  assert.equal(payload.failedRequests, 0);
  assert.equal(payload.emptyResults, 0);
  finiteNumber(payload.p50_ms, "p50");
  finiteNumber(payload.p95_ms, "p95");
  finiteNumber(payload.max_ms, "max");
  assert.ok(payload.p50_ms <= payload.p95_ms, "p50 within p95");
  assert.ok(payload.p95_ms <= payload.max_ms, "p95 within max");
});

test("P15 concurrent-load bench refuses over-budget runs", () => {
  const proc = spawnSync(
    process.execPath,
    ["--experimental-strip-types", BENCH, "--records", "30", "--concurrency", "51", "--iterations", "2"],
    { encoding: "utf8", timeout: 120000 },
  );
  assert.equal(proc.status, 2, "over-budget runs must exit 2");
});
