/** Automated clean-consumer smoke for a fixture-generated Build Kit starter (residual R1).
 *
 * Closes the AF-05d manual-proof gap with a reproducible machine check:
 * from deterministic in-repo fixture inputs, synthesize the 9-file
 * starter plus the real kit-sibling theme, then in a pristine temp
 * directory (kit layout, no monorepo files) install pinned dependencies,
 * typecheck strictly, build for production, start, and assert HTTP 200
 * with placeholder sections and zero observed copy.
 *
 * Usage: `node --experimental-strip-types scripts/prove_starter_consumer.mjs [--port N]`.
 * Exit non-zero with a fail-closed message on the first violation.
 * Network is required for the one-time pinned dependency install and for
 * localhost HTTP against the started server. The fixture inputs are
 * synthetic and offline; the only network egress is the npm registry
 * plus loopback.
 */
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { assembleLensReport } from "../packages/lens/src/report-assembly.ts";
import { exportLensArtifacts } from "../packages/lens/src/export-surface.ts";
import { synthesizeStarterArtifacts } from "../packages/lens/src/starter-synthesis.ts";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const JPEG_FIXTURE = "packages/lens/tests/fixtures/valid.jpeg";

// Distinctive observed copy: accepted by the synthesizer, never emitted.
// Its absence from built output and served HTML is the no-copy proof.
const CANARY = "OBSERVED-CANARY-7f3a9d2e-do-not-emit";
const ANALYSIS_ID = "9".repeat(64);

function fail(message) {
  console.error(`STARTER_CONSUMER_FAIL ${message}`);
  process.exit(1);
}

async function run(cwd, command, args, label) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd, timeout: 300_000 });
    if (stdout) process.stdout.write(String(stdout).slice(-1500));
    if (stderr) process.stderr.write(String(stderr).slice(-1500));
  } catch (error) {
    const detail = [error.stdout, error.stderr]
      .filter((part) => typeof part === "string" && part.length > 0)
      .join("\n")
      .slice(-3000);
    fail(`${label} failed: ${error.message}\n${detail}`);
  }
}

function captured(jpegBase64) {
  return {
    kind: "result",
    status: "partial",
    sourceUrl: "https://example.org/",
    sourceSha256: "a".repeat(64),
    htmlBytes: 187,
    redirects: 0,
    title: "Example fixture",
    viewport: "desktop",
    sections: [
      { tag: "header", text: "Observed header" },
      { tag: "main", text: CANARY },
      { tag: "section", text: "Observed section" },
      { tag: "footer", text: "Observed footer" },
    ],
    assets: [],
    screenshotBase64: jpegBase64,
    screenshotMime: "image/jpeg",
    declarations: [
      { ref: "#brand", property: "color", value: "#abc" },
      { ref: "h1", property: "font-size", value: "24px" },
    ],
    techSignals: [],
    techTruncated: false,
    coverageGaps: ["javascript-disabled", "external-resources-blocked", "viewport-only-screenshot"],
  };
}

async function main() {
  const portArg = process.argv.find((arg) => arg.startsWith("--port="));
  const port = portArg ? Number(portArg.split("=")[1]) : 3127;
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`invalid port: ${portArg ?? ""}`);

  const jpegPath = resolve(ROOT, JPEG_FIXTURE);
  if (!jpegPath.startsWith(ROOT + sep)) fail(`fixture path escapes repository: ${JPEG_FIXTURE}`);
  let jpegBase64;
  try {
    jpegBase64 = (await readFile(jpegPath)).toString("base64");
  } catch (error) {
    fail(`unreadable fixture ${JPEG_FIXTURE}: ${error.message}`);
  }

  const report = assembleLensReport(captured(jpegBase64), [
    { ref: "#brand", property: "color", value: "#abc" },
    { ref: "h1", property: "font-size", value: "24px" },
  ]);
  const bundle = exportLensArtifacts(report);
  const theme = bundle.artifacts.find((entry) => entry.path === "shadcn-theme.css");
  if (!theme || typeof theme.content !== "string" || theme.content.length === 0) {
    fail("export bundle carries no shadcn-theme.css sibling");
  }

  const files = synthesizeStarterArtifacts({
    analysisId: ANALYSIS_ID,
    sections: [{ tag: "header" }, { tag: "main", text: CANARY }, { tag: "section" }, { tag: "footer" }],
    colorCount: 1,
    spacingCount: 0,
    hasTypography: true,
    truncated: false,
  });
  if (files.length !== 9) fail(`expected the fixed 9-file starter set, got ${files.length}`);
  for (const file of files) {
    if (
      typeof file.path !== "string" || typeof file.content !== "string" ||
      !file.path.startsWith("starter/") || file.path.includes("..") ||
      file.path.includes("\\") || file.path.length > 256
    ) {
      fail(`unsafe starter path: ${file.path}`);
    }
    if (file.content.includes(CANARY)) fail(`observed copy leaked into ${file.path}`);
  }

  const sandbox = await mkdtemp(join(tmpdir(), "skelet-starter-proof-"));
  let server = null;
  try {
    const kit = join(sandbox, "kit");
    await mkdir(join(kit, "starter", "app"), { recursive: true });
    await writeFile(join(kit, "shadcn-theme.css"), theme.content);
    for (const file of files) {
      const target = join(kit, file.path);
      if (!target.startsWith(kit + sep)) fail(`starter path escapes kit: ${file.path}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    const starter = join(kit, "starter");
    await run(starter, NPM, ["install", "--no-audit", "--no-fund"], "npm install");
    await run(starter, NPM, ["run", "typecheck"], "npm run typecheck");
    await run(starter, NPM, ["run", "build"], "npm run build");

    server = spawn(NPM, ["run", "start", "--", "-p", String(port)], { cwd: starter, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", (chunk) => process.stdout.write(`[starter] ${chunk}`));
    server.stderr.on("data", (chunk) => process.stderr.write(`[starter] ${chunk}`));
    const deadline = Date.now() + 90_000;
    let response = null;
    for (;;) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/`);
        break;
      } catch {
        if (Date.now() > deadline) fail("starter did not accept HTTP within 90s");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (response.status !== 200) fail(`expected starter HTTP 200, got ${response.status}`);
    const html = await response.text();
    for (const marker of ['data-skelet-section="main"', "Replace with your own copy"]) {
      if (!html.includes(marker)) fail(`starter serves no placeholder sections (missing ${marker})`);
    }
    if (html.includes(CANARY)) fail("observed copy leaked into served HTML");
    console.log(`STARTER_CONSUMER_OK files=9 port=${port} placeholders=yes canary=absent`);
  } finally {
    if (server !== null) {
      server.kill("SIGTERM");
      setTimeout(() => server.kill("SIGKILL"), 5000).unref();
    }
    await rm(sandbox, { recursive: true, force: true });
  }
}

await main();
