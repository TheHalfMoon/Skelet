import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = dirname(require.resolve("../../package.json"));
const BENCH = join(repoRoot, "scripts", "bench_board_changes.mjs");

function finiteNumber(value, context) {
  assert.equal(typeof value, "number", `${context}: must be a number`);
  assert.ok(Number.isFinite(value), `${context}: must be finite`);
  assert.ok(value >= 0, `${context}: must be non-negative`);
}

test("AC-00 perf baseline bench runs deterministically with a valid evidence schema", () => {
  const proc = spawnSync(
    process.execPath,
    ["--experimental-strip-types", BENCH, "--products", "2", "--versions", "2", "--artifacts", "6", "--flows", "2", "--iterations", "3"],
    { encoding: "utf8", timeout: 120000 },
  );
  assert.equal(proc.status, 0, `bench must exit zero (stderr: ${(proc.stderr ?? "").slice(0, 500)})`);
  const payload = JSON.parse(proc.stdout);
  assert.equal(payload.dataset, "synthetic-2p-2v-6a-2f");
  assert.equal(payload.engine, "pglite-embedded");
  assert.ok(typeof payload.note === "string" && payload.note.length > 0);
  assert.deepEqual(
    payload.results.map((entry) => entry.op),
    ["list_flows", "get_flow_steps", "get_changes", "find_similar"],
  );
  for (const entry of payload.results) {
    assert.equal(entry.iterations, 3);
    finiteNumber(entry.p50_ms, `${entry.op} p50`);
    finiteNumber(entry.p95_ms, `${entry.op} p95`);
    finiteNumber(entry.max_ms, `${entry.op} max`);
    finiteNumber(entry.result_size, `${entry.op} result_size`);
    assert.ok(entry.result_size > 0, `${entry.op}: seeded corpus must yield results`);
    assert.ok(entry.p50_ms <= entry.p95_ms, `${entry.op}: p50 within p95`);
    assert.ok(entry.p95_ms <= entry.max_ms, `${entry.op}: p95 within max`);
  }
});
