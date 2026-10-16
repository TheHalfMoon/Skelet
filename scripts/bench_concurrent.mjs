/**
 * P15 concurrent-load bench (Skelet-owned, no-prod-dependency).
 *
 * Seeds a fixed synthetic corpus into embedded PGlite, then fires
 * parallel lexical searches to prove the search path behaves under
 * concurrent load locally: every request must succeed with results,
 * and the latency distribution is reported. Timings are
 * environment-relative (PGlite), not production SLOs, and must never
 * be cited as hosted-scale proof.
 *
 * Usage:
 *   node scripts/bench_concurrent.mjs [--records 200] [--concurrency 10] [--iterations 5]
 *
 * Exit codes: 0 all requests succeeded, 1 any request failed, 2 invalid input.
 * No embeddings, no network, no paid services.
 */

import { openDatabase } from "../packages/db/src/db.ts";
import { migrateUp } from "../packages/db/src/migrate.ts";
import { createSource } from "../packages/db/src/repositories.ts";
import { registerAsset, searchAssetsDetailed } from "../packages/assets/src/registry.ts";

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const RECORDS = arg("--records", 200);
const CONCURRENCY = arg("--concurrency", 10);
const ITERATIONS = arg("--iterations", 5);

if (RECORDS > 5000 || CONCURRENCY > 50 || ITERATIONS > 50) {
  process.stderr.write("bench_concurrent: budget exceeded (records<=5000, concurrency<=50, iterations<=50).\n");
  process.exit(2);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function main() {
  const db = await openDatabase();
  try {
    await migrateUp(db);
    const source = await createSource(db, { key: "bench-concurrent-source", kind: "synthetic" });
    const kinds = ["icon", "logo", "font"];
    for (let i = 0; i < RECORDS; i += 1) {
      await registerAsset(db, {
        kind: kinds[i % kinds.length],
        title: `Load probe record ${String(i).padStart(4, "0")} arrow`,
        sourceId: source.id,
        contentHash: `${String(i % 10)}`.repeat(64),
        rightsClassification: "permitted",
        metadata: { collection: "bench", ref: `load-${i}`, tags: ["bench", "arrow", `tag-${i % 13}`] },
      });
    }
    // Warm up.
    await searchAssetsDetailed(db, { query: "arrow", includeFacets: false, limit: 20, offset: 0 });
    const latencies = [];
    let failed = 0;
    let empty = 0;
    for (let round = 0; round < ITERATIONS; round += 1) {
      const batch = Array.from({ length: CONCURRENCY }, (_, slot) => (async () => {
        const start = performance.now();
        try {
          const detailed = await searchAssetsDetailed(db, {
            query: slot % 2 === 0 ? "arrow" : `tag-${slot % 13}`,
            includeFacets: slot % 3 === 0,
            limit: 20,
            offset: 0,
          });
          latencies.push(performance.now() - start);
          if (!Array.isArray(detailed.assets) || detailed.assets.length === 0) empty += 1;
        } catch {
          failed += 1;
        }
      })());
      await Promise.all(batch);
    }
    latencies.sort((a, b) => a - b);
    const total = ITERATIONS * CONCURRENCY;
    console.log(JSON.stringify({
      dataset: `synthetic-${RECORDS}-records`,
      engine: "pglite-embedded",
      note: "Parallel lexical search only; no embeddings. PGlite timings are environment-relative, not production SLOs.",
      concurrency: CONCURRENCY,
      iterations: ITERATIONS,
      totalRequests: total,
      failedRequests: failed,
      emptyResults: empty,
      p50_ms: Number(percentile(latencies, 50).toFixed(2)),
      p95_ms: Number(percentile(latencies, 95).toFixed(2)),
      max_ms: Number((latencies[latencies.length - 1] ?? 0).toFixed(2)),
    }, null, 2));
    if (failed > 0 || empty > 0 || latencies.length !== total) {
      process.exit(1);
    }
  } finally {
    await db.close();
  }
}

await main();
