import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * AF-05g-i: the supported Lens-to-Build-Kit chain must run with zero
 * mandatory paid services. This guard fails if a provider credential, a
 * provider SDK import, or an outbound network call enters the chain path:
 * deterministic capture, report assembly, export surface, kit manifest,
 * kit packaging, starter synthesis, the durable store, or the
 * REST/MCP/UI serving layers. Static scans are the mechanism because the
 * chain must not even reference paid integrations, not merely avoid
 * calling them at runtime.
 */
const CHAIN_DIRS = [
  "packages/lens/src",
  "packages/db/src",
  "apps/web/lib",
  "apps/web/app/api/v1/lens",
  "apps/web/app/lens",
];

const FORBIDDEN_CREDENTIALS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "COHERE_API_KEY",
  "MISTRAL_API_KEY",
  "REPLICATE_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "HF_TOKEN",
];

const FORBIDDEN_IMPORTS = [
  "packages/providers",
  "openai/",
  "@anthropic-ai/",
  "@google/generative-ai",
];

function hasRuntimeImport(source, specifier) {
  // Prose mentions (comments, descriptor docs) are not dependencies; only
  // module loads count. Matches `from "spec"`, `from 'spec'`,
  // `import("spec")`, and `require("spec")`.
  const pattern = new RegExp(
    `(from\\s+["']|import\\(\\s*["']|require\\(\\s*["'])${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
  return pattern.test(source);
}

async function chainFiles() {
  const files = [];
  for (const dir of CHAIN_DIRS) {
    const entries = await readdir(new URL(`../../../${dir}/`, import.meta.url));
    for (const entry of entries) {
      if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        files.push(join(dir, entry));
      }
    }
  }
  // The durable store and serving layers are single-file-heavy; include the
  // recursive lens API routes explicitly (one level deep above sufficed for
  // lib/src; routes nest under [id]/).
  const nested = await readdir(new URL("../../../apps/web/app/api/v1/lens/jobs/[id]/", import.meta.url));
  for (const entry of nested) {
    if (entry.endsWith(".ts")) files.push(`apps/web/app/api/v1/lens/jobs/[id]/${entry}`);
  }
  for (const sub of ["artifacts", "cancel", "resume", "retry"]) {
    const entries = await readdir(
      new URL(`../../../apps/web/app/api/v1/lens/jobs/[id]/${sub}/`, import.meta.url),
    );
    for (const entry of entries) {
      if (entry.endsWith(".ts")) files.push(`apps/web/app/api/v1/lens/jobs/[id]/${sub}/${entry}`);
    }
  }
  return [...new Set(files)].sort();
}

test("chain source references no paid provider credential", async () => {
  const files = await chainFiles();
  assert.ok(files.length > 20, `chain file set is substantial (saw ${files.length})`);
  for (const file of files) {
    const source = await readFile(new URL(`../../../${file}`, import.meta.url), "utf8");
    for (const credential of FORBIDDEN_CREDENTIALS) {
      assert.ok(!source.includes(credential), `${file} must not reference ${credential}`);
    }
    for (const imported of FORBIDDEN_IMPORTS) {
      assert.ok(!hasRuntimeImport(source, imported), `${file} must not import ${imported}`);
    }
  }
});

test("chain source performs no outbound network calls", async () => {
  const files = await chainFiles();
  let sameOriginCalls = 0;
  for (const file of files) {
    const source = await readFile(new URL(`../../../${file}`, import.meta.url), "utf8");
    // The UI's genuine transport is same-origin fetch to our own REST
    // routes (relative /api/ paths). Absolute-URL fetch is forbidden on
    // the chain path: providers, CDNs, and telemetry included.
    for (const match of source.matchAll(/(?<![A-Za-z0-9_.])fetch\(/g)) {
      const window = source.slice(match.index ?? 0, (match.index ?? 0) + 160);
      assert.ok(!/https?:\/\//.test(window), `${file} must not fetch an absolute URL`);
      sameOriginCalls += 1;
    }
  }
  assert.ok(sameOriginCalls >= 3, "UI same-origin REST calls stay covered by the guard");
});

test("chain runs with provider credentials scrubbed from the environment", async () => {
  for (const credential of FORBIDDEN_CREDENTIALS) {
    delete process.env[credential];
  }
  const { assembleKitManifest } = await import("../src/kit-manifest.ts");
  const { buildKitPackage, parseKitPackage } = await import("../src/kit-package.ts");
  assert.equal(typeof assembleKitManifest, "function");
  assert.equal(typeof buildKitPackage, "function");
  assert.equal(typeof parseKitPackage, "function");
});
