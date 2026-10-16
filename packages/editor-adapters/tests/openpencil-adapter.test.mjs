import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  OPENPENCIL_PIN,
  OpenpencilAdapterError,
  buildPenDocument,
  inspectOpenpencilSvg,
  invokeOpenpencil,
  openpencilAvailability,
  openpencilHealth,
  validateOpenpencilAdapterConfig,
  validateOpenpencilSvgOutput,
} from "../src/openpencil-adapter.ts";

const GOOD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect x="0" y="0" width="48" height="48" fill="#ff0000"/></svg>\n`;
const GOOD_PEN = `${JSON.stringify({ version: "1", children: [{ type: "frame", id: "skilit-tokens", name: "Skilit Tokens", width: 360, height: 64, children: [{ type: "rectangle", id: "swatch-01", name: "Swatch 1", x: 0, y: 0, width: 48, height: 48, fill: "#ff0000" }] }] }, null, 2)}\n`;
const PACK_URI = "skilit://collection/123e4567-e89b-12d3-a456-426614174000";

function goodConfig(rootDir, executablePath, overrides = {}) {
  return {
    enabled: true,
    executablePath,
    rootDir,
    timeoutMs: 5_000,
    maxOutputBytes: 512 * 1024,
    versionPin: OPENPENCIL_PIN,
    ...overrides,
  };
}

function requestor() {
  return { actorId: "actor-01", workspaceId: "ws-01" };
}

async function makeRoot() {
  return mkdtemp(join(tmpdir(), "skilit-p14-"));
}

async function writeExe(dir, name, body) {
  const path = join(dir, name);
  await writeFile(path, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  await chmod(path, 0o755);
  return path;
}

const GOOD_FIXTURE = `
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const op = args[0];
function json(value) { console.log(JSON.stringify(value)); }
if (op === "tree") { json([{ id: "n1", type: "FRAME", name: "Root" }]); process.exit(0); }
if (op === "info") { json({ pages: 1, totalNodes: 2, pageCounts: {}, types: {}, fonts: [] }); process.exit(0); }
if (op === "node") {
  const idIndex = args.indexOf("--id");
  const id = idIndex >= 0 ? args[idIndex + 1] : "unknown";
  json({ id, type: "FRAME", name: "Root" });
  process.exit(0);
}
if (op === "query") {
  const selector = args[2] ?? "";
  json([{ id: "q1", selector }]);
  process.exit(0);
}
if (op === "export") {
  const formatIndex = args.indexOf("--format");
  const outputIndex = args.indexOf("--output");
  const format = formatIndex >= 0 ? String(args[formatIndex + 1]).toLowerCase() : "svg";
  const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
  if (!output) { console.error("missing output"); process.exit(2); }
  if (format === "svg") { writeFileSync(output, ${JSON.stringify(GOOD_SVG)}); process.exit(0); }
  if (format === "fig") { writeFileSync(output, Buffer.from("FIG1" + readFileSync(args[1]).length)); process.exit(0); }
  writeFileSync(output, Buffer.from("BYTES:" + format));
  process.exit(0);
}
if (op === "convert") {
  const outputIndex = args.indexOf("--output");
  const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
  const data = readFileSync(args[1]);
  writeFileSync(output, data);
  process.exit(0);
}
console.error("unknown op");
process.exit(2);
`;

const MALFORMED_FIXTURE = `
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "tree" || args[0] === "info" || args[0] === "node" || args[0] === "query") {
  console.log("this is not json");
  process.exit(0);
}
if (args[0] === "export" || args[0] === "convert") {
  const outputIndex = args.indexOf("--output");
  const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
  writeFileSync(output, "definitely not svg");
  process.exit(0);
}
process.exit(2);
`;

const HANG_FIXTURE = `
setTimeout(() => {}, 30_000);
`;

const FAIL_FIXTURE = `
console.error("fixture boom details");
process.exit(3);
`;

const LARGE_FIXTURE = `
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "info" || args[0] === "tree" || args[0] === "node" || args[0] === "query") {
  console.log(JSON.stringify({ blob: "x".repeat(256 * 1024) }));
  process.exit(0);
}
if (args[0] === "export" || args[0] === "convert") {
  const outputIndex = args.indexOf("--output");
  const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
  writeFileSync(output, Buffer.alloc(256 * 1024, "x"));
  process.exit(0);
}
process.exit(2);
`;

const SCRIPT_OUTPUT_FIXTURE = `
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "export") {
  const outputIndex = args.indexOf("--output");
  writeFileSync(args[outputIndex + 1], '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
  process.exit(0);
}
process.exit(2);
`;

const ENV_DUMP_FIXTURE = `
const args = process.argv.slice(2);
if (args[0] === "info") {
  console.log(JSON.stringify(process.env));
  process.exit(0);
}
process.exit(2);
`;

async function setupGood(root) {
  const binDir = join(root, "bin");
  await mkdir(binDir, { recursive: true });
  const exe = await writeExe(binDir, "fake-openpencil.mjs", GOOD_FIXTURE);
  await writeFile(join(root, "doc.pen"), GOOD_PEN);
  await writeFile(join(root, "doc.fig"), Buffer.from("FIGHEAD"));
  return exe;
}

test("disabled-by-default without explicit opt-in", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "fake.mjs", GOOD_FIXTURE);
    await writeFile(join(root, "doc.pen"), GOOD_PEN);
    const disabled = { enabled: false, executablePath: exe, rootDir: root, versionPin: OPENPENCIL_PIN };
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "doc.pen" }, disabled),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/disabled",
    );
    const implicit = { rootDir: root };
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "doc.pen" }, implicit),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/disabled",
    );
    const availability = await openpencilAvailability(disabled);
    assert.equal(availability.available, false);
    assert.equal(availability.reason, "disabled");
    const health = await openpencilHealth(disabled);
    assert.equal(health.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing executable fails as unavailable", async () => {
  const root = await makeRoot();
  try {
    await writeFile(join(root, "doc.pen"), GOOD_PEN);
    const config = goodConfig(root, join(root, "bin", "does-not-exist.mjs"));
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "doc.pen" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/unavailable",
    );
    const availability = await openpencilAvailability(config);
    assert.equal(availability.available, false);
    assert.equal(availability.reason, "unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid configurations fail closed", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "fake.mjs", GOOD_FIXTURE);
    await writeFile(join(root, "doc.pen"), GOOD_PEN);
    const cases = [
      { enabled: true, executablePath: "relative/path", rootDir: root, versionPin: OPENPENCIL_PIN },
      { enabled: true, executablePath: exe, rootDir: "relative/root", versionPin: OPENPENCIL_PIN },
      { enabled: true, executablePath: exe, rootDir: root, versionPin: "deadbeef".repeat(5).slice(0, 40) },
      { enabled: true, executablePath: exe, rootDir: root, versionPin: OPENPENCIL_PIN, timeoutMs: 0 },
      { enabled: true, executablePath: exe, rootDir: root, versionPin: OPENPENCIL_PIN, timeoutMs: 999_999 },
      { enabled: true, executablePath: exe, rootDir: root, versionPin: OPENPENCIL_PIN, maxOutputBytes: 10 },
    ];
    for (const bad of cases) {
      assert.throws(() => validateOpenpencilAdapterConfig(bad), (error) => error instanceof OpenpencilAdapterError && error.code === "document/invalid-config", JSON.stringify(bad));
    }
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "doc.pen" }, { enabled: true, executablePath: exe, rootDir: join(root, "missing-root"), versionPin: OPENPENCIL_PIN }),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/invalid-config",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("authorized opt-in reads tree, node, query, and info", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    assert.equal((await openpencilAvailability(config)).available, true);
    assert.equal((await openpencilHealth(config)).ok, true);

    const tree = await invokeOpenpencil({ operation: "tree", requestor: requestor(), inputFile: "doc.pen" }, config);
    assert.deepEqual(tree.stdoutJson, [{ id: "n1", type: "FRAME", name: "Root" }]);
    assert.equal(tree.provenance.adapterId, "skilit-document");
    assert.equal(tree.provenance.capability, "editable-document");
    assert.equal(tree.provenance.version, OPENPENCIL_PIN);
    assert.equal(tree.provenance.egress, "local");
    assert.equal(tree.provenance.costClass, "free-local");

    const info = await invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "doc.fig" }, config);
    assert.deepEqual(info.stdoutJson, { pages: 1, totalNodes: 2, pageCounts: {}, types: {}, fonts: [] });

    const node = await invokeOpenpencil({ operation: "node", requestor: requestor(), inputFile: "doc.pen", nodeId: "n1" }, config);
    assert.deepEqual(node.stdoutJson, { id: "n1", type: "FRAME", name: "Root" });

    const query = await invokeOpenpencil({ operation: "query", requestor: requestor(), inputFile: "doc.pen", selector: "//FRAME" }, config);
    assert.deepEqual(query.stdoutJson, [{ id: "q1", selector: "//FRAME" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("export and convert produce hashed artifacts with provenance", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    const exported = await invokeOpenpencil(
      { operation: "export", requestor: requestor(), inputFile: "doc.pen", outputFile: "out.svg", format: "svg" },
      config,
    );
    assert.equal(exported.operation, "export");
    assert.ok((exported.outputFile ?? "").endsWith("out.svg"));
    assert.ok((exported.outputBytes ?? 0) > 0);
    assert.match(exported.outputSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(exported.provenance.egress, "local");
    const svg = await readFile(join(root, "out.svg"), "utf8");
    assert.equal(svg, GOOD_SVG);

    const converted = await invokeOpenpencil(
      { operation: "convert", requestor: requestor(), inputFile: "doc.pen", outputFile: "out.fig" },
      config,
    );
    assert.equal(converted.operation, "convert");
    assert.match(converted.outputSha256 ?? "", /^[a-f0-9]{64}$/);
    const figBytes = await readFile(join(root, "out.fig"));
    assert.ok(figBytes.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pack to editable pen to export to reopen journey", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    const penJson = buildPenDocument({
      requestor: requestor(),
      pack: { packUri: PACK_URI, workspaceId: "ws-01" },
      tokens: { colors: ["#ff0000", "#00ff00"], sizes: [12], spacing: [8], radius: [4] },
    });
    const parsed = JSON.parse(penJson);
    assert.ok(Array.isArray(parsed.children));
    assert.equal(parsed.children[0].type, "frame");
    assert.ok(parsed.children[0].children.length >= 2);
    await writeFile(join(root, "pack.pen"), penJson);

    const converted = await invokeOpenpencil(
      { operation: "convert", requestor: requestor(), inputFile: "pack.pen", outputFile: "pack.fig" },
      config,
    );
    assert.match(converted.outputSha256 ?? "", /^[a-f0-9]{64}$/);

    const exported = await invokeOpenpencil(
      { operation: "export", requestor: requestor(), inputFile: "pack.fig", outputFile: "pack.svg", format: "svg" },
      config,
    );
    const svg = await readFile(join(root, "pack.svg"), "utf8");
    validateOpenpencilSvgOutput(svg, 512 * 1024);
    const inspection = inspectOpenpencilSvg(svg);
    assert.ok(inspection.width > 0 && inspection.height > 0 && inspection.shapes > 0);
    assert.match(exported.outputSha256 ?? "", /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed pen documents fail deterministically", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    await writeFile(join(root, "bad.pen"), "{ not json");
    await assert.rejects(
      () => invokeOpenpencil({ operation: "export", requestor: requestor(), inputFile: "bad.pen", outputFile: "bad.svg", format: "svg" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/malformed-output",
    );
    await writeFile(join(root, "empty.pen"), JSON.stringify({ version: "1" }));
    await assert.rejects(
      () => invokeOpenpencil({ operation: "convert", requestor: requestor(), inputFile: "empty.pen", outputFile: "empty.fig" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/malformed-output",
    );
    const binDir = join(root, "bin");
    const malformed = await writeExe(binDir, "malformed.mjs", MALFORMED_FIXTURE);
    const malformedConfig = goodConfig(root, malformed);
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "doc.pen" }, malformedConfig),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/malformed-output",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsupported formats fail with stable contracts", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    await writeFile(join(root, "in.svg"), GOOD_SVG);
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "in.svg" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/unsupported-format",
    );
    await assert.rejects(
      () => invokeOpenpencil({ operation: "export", requestor: requestor(), inputFile: "doc.pen", outputFile: "out.pdf", format: "pdf" }, config),
      (error) => error instanceof OpenpencilAdapterError && (error.code === "document/unsupported-format" || error.code === "document/invalid-input"),
    );
    await assert.rejects(
      () => invokeOpenpencil({ operation: "convert", requestor: requestor(), inputFile: "doc.pen", outputFile: "out.svg" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/unsupported-format",
    );
    await assert.rejects(
      () => invokeOpenpencil({ operation: "export", requestor: requestor(), inputFile: "doc.pen", outputFile: "out.svg", format: "svg", page: "P1", nodeId: "n1" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/invalid-input",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("absolute paths outside the root are refused", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "/etc/passwd" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/path-escape",
    );
    await assert.rejects(
      () => invokeOpenpencil({ operation: "export", requestor: requestor(), inputFile: "doc.pen", outputFile: "/tmp/p14-outside.svg", format: "svg" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/path-escape",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("path traversal is refused", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    for (const evil of ["../outside.pen", "a/../../outside.pen", "sub/../../../etc/passwd"]) {
      await assert.rejects(
        () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: evil }, config),
        (error) => error instanceof OpenpencilAdapterError && (error.code === "document/path-escape" || error.code === "document/invalid-input"),
        evil,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symlink escapes are refused for inputs and outputs", async () => {
  const root = await makeRoot();
  const outside = await makeRoot();
  try {
    const exe = await setupGood(root);
    await writeFile(join(outside, "secret.pen"), GOOD_PEN);
    await symlink(join(outside, "secret.pen"), join(root, "link.pen"));
    await mkdir(join(root, "realdir"), { recursive: true });
    await symlink(outside, join(root, "linkdir"));
    const config = goodConfig(root, exe);
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "link.pen" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/path-escape",
    );
    await assert.rejects(
      () => invokeOpenpencil({ operation: "export", requestor: requestor(), inputFile: "doc.pen", outputFile: "linkdir/evil.svg", format: "svg" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/path-escape",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("unsupported operations and app-bridge targeting fail closed", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    for (const operation of ["documents", "import", "diff", "eval", "tool", "tokens", "formats", "delete"]) {
      await assert.rejects(
        () => invokeOpenpencil({ operation, requestor: requestor(), inputFile: "doc.pen" }, config),
        (error) => error instanceof OpenpencilAdapterError && (error.code === "document/unsupported-operation" || error.code === "document/invalid-input"),
        String(operation),
      );
    }
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "doc.pen", "document-id": "abc" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/unsupported-operation",
    );
    await assert.rejects(
      () => invokeOpenpencil({ operation: "export", requestor: requestor(), inputFile: "doc.pen", outputFile: "out.svg", format: "svg", scale: 99 }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/invalid-input",
    );
    await assert.rejects(
      () => invokeOpenpencil({ operation: "export", requestor: requestor(), inputFile: "doc.pen", outputFile: "out.png", format: "png", quality: 90 }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/invalid-input",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("process timeout and cancellation are deterministic", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const hang = await writeExe(binDir, "hang.mjs", HANG_FIXTURE);
    await writeFile(join(root, "doc.pen"), GOOD_PEN);
    const config = goodConfig(root, hang, { timeoutMs: 300 });
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "doc.pen" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/timeout",
    );
    const controller = new AbortController();
    const pending = invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "doc.pen" }, goodConfig(root, hang), { signal: controller.signal });
    controller.abort();
    await assert.rejects(
      pending,
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/canceled",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resource budgets fail closed", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const large = await writeExe(binDir, "large.mjs", LARGE_FIXTURE);
    await writeFile(join(root, "doc.pen"), GOOD_PEN);
    const tight = goodConfig(root, large, { maxOutputBytes: 4_096 });
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "doc.pen" }, tight),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/output-limit",
    );
    const exe = await setupGood(root);
    const bigInput = join(root, "big.pen");
    await writeFile(bigInput, Buffer.alloc(9 * 1024 * 1024, "x"));
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "big.pen" }, goodConfig(root, exe)),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/invalid-input",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("no shell injection via selector argv", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    const evil = "//FRAME; rm -rf /tmp/p14-proof";
    const result = await invokeOpenpencil({ operation: "query", requestor: requestor(), inputFile: "doc.pen", selector: evil }, config);
    assert.deepEqual(result.stdoutJson, [{ id: "q1", selector: evil }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("no environment-secret inheritance", async () => {
  const root = await makeRoot();
  const secret = "SKILIT_P14_TEST_SECRET_VALUE";
  process.env[secret] = "should-never-leak";
  process.env.SKILIT_P14_SENTINEL = "sentinel-value";
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "env.mjs", ENV_DUMP_FIXTURE);
    await writeFile(join(root, "doc.pen"), GOOD_PEN);
    const result = await invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "doc.pen" }, goodConfig(root, exe));
    const dumped = JSON.stringify(result.stdoutJson);
    assert.ok(!dumped.includes("should-never-leak"));
    assert.ok(!dumped.includes("sentinel-value"));
  } finally {
    delete process.env[secret];
    delete process.env.SKILIT_P14_SENTINEL;
    await rm(root, { recursive: true, force: true });
  }
});

test("anonymous requestors and missing pack provenance are refused", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", inputFile: "doc.pen" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/invalid-input",
    );
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: { actorId: "", workspaceId: "ws-01" }, inputFile: "doc.pen" }, config),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/invalid-input",
    );
    assert.throws(
      () => buildPenDocument({ requestor: requestor(), tokens: { colors: ["#ff0000"], sizes: [], spacing: [], radius: [] } }),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/invalid-input",
    );
    assert.throws(
      () => buildPenDocument({ requestor: requestor(), pack: { packUri: PACK_URI, workspaceId: "ws-02" }, tokens: { colors: ["#ff0000"], sizes: [], spacing: [], radius: [] } }),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/invalid-input",
    );
    assert.throws(
      () => buildPenDocument({ requestor: requestor(), pack: { packUri: "not-a-uri", workspaceId: "ws-01" }, tokens: { colors: ["#ff0000"], sizes: [], spacing: [], radius: [] } }),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/invalid-input",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("upstream failures and unsafe outputs are typed", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const failExe = await writeExe(binDir, "fail.mjs", FAIL_FIXTURE);
    await writeFile(join(root, "doc.pen"), GOOD_PEN);
    await assert.rejects(
      () => invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "doc.pen" }, goodConfig(root, failExe)),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/failed",
    );
    const scriptExe = await writeExe(binDir, "script.mjs", SCRIPT_OUTPUT_FIXTURE);
    await assert.rejects(
      () => invokeOpenpencil({ operation: "export", requestor: requestor(), inputFile: "doc.pen", outputFile: "evil.svg", format: "svg" }, goodConfig(root, scriptExe)),
      (error) => error instanceof OpenpencilAdapterError && error.code === "document/malformed-output",
    );
    assert.throws(() => validateOpenpencilSvgOutput('<svg width="10"><script>alert(1)</script></svg>', 1024), (error) => error instanceof OpenpencilAdapterError);
    const inspection = inspectOpenpencilSvg(GOOD_SVG);
    assert.equal(inspection.width, 96);
    assert.equal(inspection.height, 96);
    assert.ok(inspection.shapes >= 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("no-model local operation carries free-local provenance", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    for (const operation of ["tree", "info"]) {
      const result = await invokeOpenpencil({ operation, requestor: requestor(), inputFile: "doc.pen" }, config);
      assert.equal(result.provenance.egress, "local");
      assert.equal(result.provenance.costClass, "free-local");
      assert.equal(result.provenance.version, OPENPENCIL_PIN);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("genuine binary interoperability when operator binary is present", async (t) => {
  const candidate =
    process.env.SKILIT_DOCUMENT_BIN ??
    process.env.SKILIT_OPENPENCIL_BIN ??
    process.env.SKELET_OPENPENCIL_BIN;
  if (!candidate) {
    t.skip("SKILIT_DOCUMENT_BIN is not set; genuine-binary proof remains future work.");
    return;
  }
  const root = await makeRoot();
  try {
    await writeFile(join(root, "doc.pen"), GOOD_PEN);
    const config = goodConfig(root, candidate);
    const availability = await openpencilAvailability(config);
    if (!availability.available) {
      t.skip("Operator OpenPencil binary is not executable; genuine-binary proof remains future work.");
      return;
    }
    const info = await invokeOpenpencil({ operation: "info", requestor: requestor(), inputFile: "doc.pen" }, config);
    assert.ok(info.stdoutJson !== undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
