/**
 * AC-00 perf baseline: board-adjacent read latency on embedded PGlite.
 *
 * Seeds a fixed synthetic corpus (products x versions x artifacts plus
 * ordered flows, deterministic titles) into embedded PGlite, warms each
 * read path once, then measures warm p50/p95 latency for the flows,
 * steps, version-diff, and similarity reads that back boards, packs,
 * and change inspection. No embeddings, no network, no paid services.
 * Prints JSON to stdout for evidence records.
 *
 * Usage:
 *   node scripts/bench_board_changes.mjs [--products 4] [--versions 2]
 *     [--artifacts 12] [--flows 3] [--iterations 20]
 */

import { openDatabase } from "../packages/db/src/db.ts";
import { migrateUp } from "../packages/db/src/migrate.ts";
import {
  createProduct,
  createProductVersion,
  createSource,
} from "../packages/db/src/repositories.ts";
import { createArtifact } from "../packages/db/src/graph.ts";
import { addFlowStep, createFlow } from "../packages/db/src/workflows.ts";
import { signUp } from "../packages/db/src/auth.ts";
import { getChangesForActor } from "../packages/db/src/changes.ts";
import { findSimilarForActor } from "../packages/assets/src/similarity.ts";
import {
  getFlowStepsForActor,
  listFlowsForActor,
} from "../packages/ingest/src/corpus.ts";

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const PRODUCTS = arg("--products", 4);
// The version-diff op needs two versions of one product; smaller inputs
// are clamped so the bench always exercises every op.
const VERSIONS = Math.max(2, arg("--versions", 2));
const ARTIFACTS = arg("--artifacts", 12);
const FLOWS = arg("--flows", 3);
const ITERATIONS = arg("--iterations", 20);

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function main() {
  const db = await openDatabase();
  try {
    await migrateUp(db);
    const owner = await signUp(db, { email: "bench-boards@skilit.example", password: "bench-password-01" });
    const source = await createSource(db, { key: "bench-boards-source", kind: "synthetic" });
    const versionIds = [];
    let firstArtifactId = "";
    let firstFlowId = "";
    for (let p = 0; p < PRODUCTS; p += 1) {
      const product = await createProduct(db, {
        sourceId: source.id,
        externalId: `bench-board-${p}`,
        title: `Bench board product ${p}`,
      });
      for (let v = 0; v < VERSIONS; v += 1) {
        const version = await createProductVersion(db, { productId: product.id, versionNo: v + 1 });
        versionIds.push(version.id);
        const made = [];
        for (let a = 0; a < ARTIFACTS; a += 1) {
          const revised = v === 1 && a === 0;
          const artifact = await createArtifact(db, {
            sourceId: source.id,
            productId: product.id,
            productVersionId: version.id,
            kind: a % 3 === 0 ? "icon" : "screen",
            title: `Bench board record ${String(a).padStart(3, "0")}`,
            summary: revised ? "Bench revised summary" : "Bench shared summary",
            contentHash: `${String((a + v) % 10)}`.repeat(64).slice(0, 64),
            rightsClassification: "permitted",
            visibility: "public",
            metadata: { tags: ["bench-board", `tag-${a % 7}`] },
          });
          made.push(artifact.id);
          if (p === 0 && v === 0 && a === 0) firstArtifactId = artifact.id;
        }
        for (let f = 0; f < FLOWS; f += 1) {
          const flow = await createFlow(db, {
            sourceId: source.id,
            productVersionId: version.id,
            title: `Bench board flow ${f}`,
            metadata: {},
          });
          await addFlowStep(db, {
            flowId: flow.id,
            position: 0,
            artifactId: made[f % made.length],
          });
          if (p === 0 && v === 0 && f === 0) firstFlowId = flow.id;
        }
      }
    }

    const ops = [
      {
        op: "list_flows",
        run: () => listFlowsForActor(db, { actorId: owner.id, limit: 20, offset: 0 }),
        size: (out) => out.total,
      },
      {
        op: "get_flow_steps",
        run: () => getFlowStepsForActor(db, { flowId: firstFlowId, actorId: owner.id }),
        size: (out) => out.steps.length,
      },
      {
        op: "get_changes",
        run: () =>
          getChangesForActor(db, {
            actorId: owner.id,
            fromVersionId: versionIds[0],
            toVersionId: versionIds[1],
            limit: 50,
            offset: 0,
          }),
        size: (out) => out.total,
      },
      {
        op: "find_similar",
        run: () => findSimilarForActor(db, { artifactId: firstArtifactId, actorId: owner.id, limit: 20, offset: 0 }),
        size: (out) => out.total,
      },
    ];
    // Warm up.
    for (const entry of ops) {
      await entry.run();
    }
    const results = [];
    for (const entry of ops) {
      const samples = [];
      let size = 0;
      for (let i = 0; i < ITERATIONS; i += 1) {
        const start = performance.now();
        const outcome = await entry.run();
        samples.push(performance.now() - start);
        size = entry.size(outcome);
      }
      samples.sort((a, b) => a - b);
      results.push({
        op: entry.op,
        iterations: ITERATIONS,
        result_size: size,
        p50_ms: Number(percentile(samples, 50).toFixed(2)),
        p95_ms: Number(percentile(samples, 95).toFixed(2)),
        max_ms: Number(samples[samples.length - 1].toFixed(2)),
      });
    }
    console.log(JSON.stringify({
      dataset: `synthetic-${PRODUCTS}p-${VERSIONS}v-${ARTIFACTS}a-${FLOWS}f`,
      engine: "pglite-embedded",
      note: "Board-adjacent reads only; no embeddings. PGlite timings are environment-relative, not production SLOs.",
      results,
    }, null, 2));
  } finally {
    await db.close();
  }
}

await main();
