/**
 * AF-04 deterministic search benchmark.
 *
 * Seeds a fixed synthetic corpus (200 records, deterministic titles) into
 * embedded PGlite, warms the FTS path, then measures warm p50/p95 latency
 * for representative queries with and without facets. No embeddings, no
 * network, no paid services. Prints JSON to stdout for evidence records.
 *
 * Usage:
 *   node scripts/bench_search.mjs [--records 200] [--iterations 100]
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
const ITERATIONS = arg("--iterations", 100);

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function main() {
  const db = await openDatabase();
  try {
    await migrateUp(db);
    const source = await createSource(db, { key: "bench-source", kind: "synthetic" });
    const kinds = ["icon", "logo", "font"];
    const licenses = ["MIT", "Apache-2.0", "OFL-1.1", "proprietary"];
    for (let i = 0; i < RECORDS; i += 1) {
      const kind = kinds[i % kinds.length];
      const license = licenses[i % licenses.length];
      const title = `Bench arrow record ${String(i).padStart(4, "0")}`;
      await registerAsset(db, {
        kind,
        title,
        sourceId: source.id,
        contentHash: `${String(i % 10)}`.repeat(64),
        rightsClassification: i % 7 === 0 ? "restricted" : "permitted",
        metadata: {
          collection: i % 2 === 0 ? "iconify:mdi" : "fontsource",
          ref: `bench-${i}`,
          tags: ["bench", "arrow", `tag-${i % 13}`],
          license,
          ...(i % 11 === 0 ? { trademark: true } : {}),
        },
      });
    }
    const queries = [
      { query: "arrow", includeFacets: false },
      { query: "arrow", includeFacets: true },
      { query: "bench arrow", includeFacets: false },
      { query: "tag-5", includeFacets: false },
    ];
    // Warm up.
    for (const q of queries) {
      await searchAssetsDetailed(db, { ...q, limit: 20, offset: 0 });
    }
    const results = [];
    for (const q of queries) {
      const samples = [];
      let mode = "";
      for (let i = 0; i < ITERATIONS; i += 1) {
        const start = performance.now();
        const detailed = await searchAssetsDetailed(db, { ...q, limit: 20, offset: 0 });
        samples.push(performance.now() - start);
        mode = detailed.searchMode;
      }
      samples.sort((a, b) => a - b);
      results.push({
        query: q.query,
        includeFacets: q.includeFacets,
        searchMode: mode,
        iterations: ITERATIONS,
        p50_ms: Number(percentile(samples, 50).toFixed(2)),
        p95_ms: Number(percentile(samples, 95).toFixed(2)),
        max_ms: Number(samples[samples.length - 1].toFixed(2)),
      });
    }
    console.log(JSON.stringify({
      dataset: `synthetic-${RECORDS}-records`,
      engine: "pglite-embedded",
      note: "Lexical search only; no embeddings. PGlite timings are environment-relative, not production SLOs.",
      results,
    }, null, 2));
  } finally {
    await db.close();
  }
}

await main();
