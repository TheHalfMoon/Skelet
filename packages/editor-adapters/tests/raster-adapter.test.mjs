import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  PHOTOCRAFT_PIN,
  RasterAdapterError,
  buildRasterArgs,
  inspectRaster,
  invokeRaster,
  validateRasterBytes,
  validateRasterAdapterConfig,
  rasterAvailability,
  rasterHealth,
} from "../src/raster-adapter.ts";
import { tokensToSvg } from "../src/vector-adapter.ts";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function goodConfig(rootDir, executablePath, overrides = {}) {
  return {
    enabled: true,
    executablePath,
    rootDir,
    timeoutMs: 5_000,
    maxOutputBytes: 512 * 1024,
    versionPin: PHOTOCRAFT_PIN,
    ...overrides,
  };
}

function requestor() {
  return { actorId: "actor-01", workspaceId: "ws-01" };
}

async function makeRoot() {
  return mkdtemp(join(tmpdir(), "skilit-af11-"));
}

async function writeExe(dir, name, body) {
  const path = join(dir, name);
  await writeFile(path, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  await chmod(path, 0o755);
  return path;
}

const GOOD_FIXTURE = `
import { readFileSync, writeFileSync } from "node:fs";
function bytesFor(fmt) {
  const f = String(fmt).toLowerCase();
  if (f === "png") return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  if (f === "jpeg" || f === "jpg") return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x11)]);
  if (f === "webp") return Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4, 0), Buffer.from("WEBP", "ascii"), Buffer.alloc(64, 0x22)]);
  if (f === "tiff" || f === "tif") return Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(64, 0x33)]);
  if (f === "bmp") return Buffer.concat([Buffer.from([0x42, 0x4d]), Buffer.alloc(64, 0x44)]);
  return Buffer.alloc(64, 0x55);
}
const args = process.argv.slice(2);
// Genuine-emulating fixture: bare commands prints human text (like the
// real CLI); only commands --json prints the machine catalogue. This
// proves the adapter sends --json instead of parsing text.
if (args[0] === "commands") {
  if (args[1] === "--json") {
    console.log(JSON.stringify({ commands: ["convert", "info", "commands"] }));
    process.exit(0);
  }
  console.log("available commands: convert info commands (use --json)");
  process.exit(0);
}
if (args[0] === "info") {
  const data = readFileSync(args[1]);
  console.log(JSON.stringify({ bytes: data.length }));
  process.exit(0);
}
if (args[0] === "convert") {
  // Genuine CLI rejects a valued --tiff-layers (convert needs <in>
  // <out>); the bare flag selects layered TIFF output.
  const tiffIdx = args.indexOf("--tiff-layers");
  if (tiffIdx >= 0 && args[tiffIdx + 1] !== undefined && !String(args[tiffIdx + 1]).startsWith("--")) {
    console.error("convert needs <in> <out>");
    process.exit(1);
  }
  const fmtIdx = args.indexOf("--format");
  const fmt = fmtIdx >= 0 ? args[fmtIdx + 1] : "png";
  writeFileSync(args[2], bytesFor(fmt));
  process.exit(0);
}
console.error("unknown op");
process.exit(2);
`;

const MALFORMED_FIXTURE = `
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "commands" || args[0] === "info") {
  console.log("this is not json");
  process.exit(0);
}
if (args[0] === "convert") {
  writeFileSync(args[2], "definitely not raster");
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
if (args[0] === "convert") {
  writeFileSync(args[2], Buffer.alloc(256 * 1024, 0x89));
  process.exit(0);
}
if (args[0] === "info" || args[0] === "commands") {
  console.log(JSON.stringify({ blob: "x".repeat(256 * 1024) }));
  process.exit(0);
}
process.exit(2);
`;

const UNSAFE_FIXTURE = `
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "convert") {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  writeFileSync(args[2], Buffer.concat([png, Buffer.from('<script>alert(1)</script>', 'utf8')]));
  process.exit(0);
}
process.exit(2);
`;

const ENV_DUMP_FIXTURE = `
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "convert") {
  writeFileSync(args[2], JSON.stringify(process.env));
  process.exit(0);
}
process.exit(2);
`;

async function setupGood(root) {
  const binDir = join(root, "bin");
  await mkdir(binDir, { recursive: true });
  const exe = await writeExe(binDir, "fake-photocraft.mjs", GOOD_FIXTURE);
  await writeFile(join(root, "in.png"), PNG_1X1);
  return exe;
}

test("disabled-by-default without explicit opt-in", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "fake.mjs", GOOD_FIXTURE);
    await writeFile(join(root, "in.png"), PNG_1X1);
    const disabled = {
      enabled: false,
      executablePath: exe,
      rootDir: root,
      versionPin: PHOTOCRAFT_PIN,
    };
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "commands", requestor: requestor() },
          disabled,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/disabled",
    );
    const implicit = { rootDir: root };
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "commands", requestor: requestor() },
          implicit,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/disabled",
    );
    const availability = await rasterAvailability(disabled);
    assert.equal(availability.available, false);
    assert.equal(availability.reason, "disabled");
    const health = await rasterHealth(disabled);
    assert.equal(health.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing executable fails as unavailable", async () => {
  const root = await makeRoot();
  try {
    await writeFile(join(root, "in.png"), PNG_1X1);
    const config = goodConfig(root, join(root, "bin", "does-not-exist.mjs"));
    await assert.rejects(
      () => invokeRaster({ operation: "commands", requestor: requestor() }, config),
      (error) => error instanceof RasterAdapterError && error.code === "raster/unavailable",
    );
    const availability = await rasterAvailability(config);
    assert.equal(availability.available, false);
    assert.equal(availability.reason, "unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("genuine argv shapes: commands carries --json, tiff preserve is a bare flag", () => {
  assert.deepEqual(buildRasterArgs({ operation: "commands" }, { inputAbs: undefined, outputAbs: undefined }), [
    "commands",
    "--json",
  ]);
  assert.deepEqual(
    buildRasterArgs(
      { operation: "convert", inputFile: "in.png", outputFile: "out.tiff", format: "tiff", tiffLayers: "preserve" },
      { inputAbs: "/r/in.png", outputAbs: "/r/out.tiff" },
    ),
    ["convert", "/r/in.png", "/r/out.tiff", "--format", "tiff", "--tiff-layers"],
  );
  // Flatten is the genuine default: no flag is emitted, never a MODE value
  // (the real CLI rejects `--tiff-layers <value>`).
  assert.deepEqual(
    buildRasterArgs(
      { operation: "convert", inputFile: "in.png", outputFile: "out.tiff", format: "tiff", tiffLayers: "flatten" },
      { inputAbs: "/r/in.png", outputAbs: "/r/out.tiff" },
    ),
    ["convert", "/r/in.png", "/r/out.tiff", "--format", "tiff"],
  );
});

test("tiff preserve flows end to end through the genuine-emulating fixture", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    // The genuine CLI accepts only the bare flag; a valued MODE would
    // exit 1 in this fixture exactly as the real binary does.
    const preserved = await invokeRaster(
      {
        operation: "convert",
        requestor: requestor(),
        inputFile: "in.png",
        outputFile: "keep.tiff",
        format: "tiff",
        tiffLayers: "preserve",
      },
      config,
    );
    assert.equal(preserved.outputFormat, "tiff");
    const bytes = await readFile(join(root, "keep.tiff"));
    assert.deepEqual(inspectRaster(bytes, "tiff"), {
      format: "tiff",
      bytes: bytes.length,
      sha256: preserved.outputSha256,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("valid opt-in converts png, jpeg with quality, and tiff with layers", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    const availability = await rasterAvailability(config);
    assert.equal(availability.available, true);
    const health = await rasterHealth(config);
    assert.equal(health.ok, true);

    const converted = await invokeRaster(
      {
        operation: "convert",
        requestor: requestor(),
        inputFile: "in.png",
        outputFile: "out.png",
        format: "png",
      },
      config,
    );
    assert.equal(converted.operation, "convert");
    assert.ok((converted.outputFile ?? "").endsWith("out.png"));
    assert.ok((converted.outputBytes ?? 0) > 0);
    assert.match(converted.outputSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(converted.outputFormat, "png");
    assert.equal(converted.provenance.adapterId, "skilit-raster");
    assert.equal(converted.provenance.capability, "raster-export");
    assert.equal(converted.provenance.version, PHOTOCRAFT_PIN);
    assert.equal(converted.provenance.egress, "local");
    assert.equal(converted.provenance.costClass, "free-local");

    const jpeg = await invokeRaster(
      {
        operation: "convert",
        requestor: requestor(),
        inputFile: "in.png",
        outputFile: "out.jpg",
        format: "jpg",
        quality: 82,
      },
      config,
    );
    assert.equal(jpeg.outputFormat, "jpg");

    const tiff = await invokeRaster(
      {
        operation: "convert",
        requestor: requestor(),
        inputFile: "in.png",
        outputFile: "out.tiff",
        format: "tiff",
        tiffLayers: "flatten",
      },
      config,
    );
    assert.equal(tiff.outputFormat, "tiff");

    const info = await invokeRaster(
      { operation: "info", requestor: requestor(), inputFile: "in.png" },
      config,
    );
    assert.deepEqual(info.stdoutJson, { bytes: PNG_1X1.length });

    const commands = await invokeRaster(
      { operation: "commands", requestor: requestor() },
      config,
    );
    assert.deepEqual(commands.stdoutJson, { commands: ["convert", "info", "commands"] });
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
    await writeFile(join(root, "in.png"), PNG_1X1);
    const cases = [
      { enabled: true, executablePath: "relative/path", rootDir: root, versionPin: PHOTOCRAFT_PIN },
      { enabled: true, executablePath: exe, rootDir: "relative/root", versionPin: PHOTOCRAFT_PIN },
      { enabled: true, executablePath: exe, rootDir: root, versionPin: "deadbeef".repeat(5).slice(0, 40) },
      { enabled: true, executablePath: exe, rootDir: root, versionPin: PHOTOCRAFT_PIN, timeoutMs: 0 },
      { enabled: true, executablePath: exe, rootDir: root, versionPin: PHOTOCRAFT_PIN, timeoutMs: 999_999 },
      { enabled: true, executablePath: exe, rootDir: root, versionPin: PHOTOCRAFT_PIN, maxOutputBytes: 10 },
    ];
    for (const bad of cases) {
      assert.throws(() => validateRasterAdapterConfig(bad), (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-config", JSON.stringify(bad));
    }
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "commands", requestor: requestor() },
          { enabled: true, executablePath: exe, rootDir: join(root, "missing-root"), versionPin: PHOTOCRAFT_PIN },
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-config",
    );
    const fileAsRoot = join(root, "in.png");
    await assert.rejects(
      () => invokeRaster({ operation: "commands", requestor: requestor() }, goodConfig(fileAsRoot, exe)),
      (error) => error instanceof RasterAdapterError && (error.code === "raster/invalid-config" || error.code === "raster/unavailable"),
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
      () =>
        invokeRaster(
          { operation: "info", requestor: requestor(), inputFile: "/etc/passwd" },
          config,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/path-escape",
    );
    await assert.rejects(
      () =>
        invokeRaster(
          {
            operation: "convert",
            requestor: requestor(),
            inputFile: "in.png",
            outputFile: "/tmp/af11-outside.png",
            format: "png",
          },
          config,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/path-escape",
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
    for (const evil of ["../outside.png", "a/../../outside.png", "sub/../../../etc/passwd"]) {
      await assert.rejects(
        () => invokeRaster({ operation: "info", requestor: requestor(), inputFile: evil }, config),
        (error) => error instanceof RasterAdapterError && (error.code === "raster/path-escape" || error.code === "raster/invalid-input"),
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
    await writeFile(join(outside, "secret.png"), PNG_1X1);
    await symlink(join(outside, "secret.png"), join(root, "link.png"));
    await mkdir(join(root, "realdir"), { recursive: true });
    await symlink(outside, join(root, "linkdir"));
    const config = goodConfig(root, exe);
    await assert.rejects(
      () => invokeRaster({ operation: "info", requestor: requestor(), inputFile: "link.png" }, config),
      (error) => error instanceof RasterAdapterError && error.code === "raster/path-escape",
    );
    await assert.rejects(
      () =>
        invokeRaster(
          {
            operation: "convert",
            requestor: requestor(),
            inputFile: "in.png",
            outputFile: "linkdir/evil.png",
            format: "png",
          },
          config,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/path-escape",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("unsupported operations fail with stable contracts", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    for (const operation of ["run", "batch", "droplet", "mcp", "serve", "delete"]) {
      await assert.rejects(
        () => invokeRaster({ operation, requestor: requestor(), inputFile: "in.png" }, config),
        (error) => error instanceof RasterAdapterError && (error.code === "raster/unsupported-operation" || error.code === "raster/invalid-input"),
        String(operation),
      );
    }
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "convert", requestor: requestor(), inputFile: "in.png", outputFile: "out.png" },
          config,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-input",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid formats, quality, and tiff layers fail closed", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    const badFormats = ["heif", "heic", "avif", "PNG", "exe", "", "../png", "png;rm"];
    for (const format of badFormats) {
      await assert.rejects(
        () =>
          invokeRaster(
            { operation: "convert", requestor: requestor(), inputFile: "in.png", outputFile: "out.png", format },
            config,
          ),
        (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-input",
        `format:${format}`,
      );
    }
    for (const quality of [0, 101, -1, 1.5, "82", NaN]) {
      await assert.rejects(
        () =>
          invokeRaster(
            { operation: "convert", requestor: requestor(), inputFile: "in.png", outputFile: "out.jpg", format: "jpg", quality },
            config,
          ),
        (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-input",
        `quality:${String(quality)}`,
      );
    }
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "convert", requestor: requestor(), inputFile: "in.png", outputFile: "out.png", format: "png", quality: 80 },
          config,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-input",
    );
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "convert", requestor: requestor(), inputFile: "in.png", outputFile: "out.png", format: "png", tiffLayers: "flatten" },
          config,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-input",
    );
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "convert", requestor: requestor(), inputFile: "in.png", outputFile: "out.tiff", format: "tiff", tiffLayers: "merge" },
          config,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-input",
    );
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "convert", requestor: requestor(), inputFile: "in.png", outputFile: "out.jpg", format: "png" },
          config,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-input",
    );
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "convert", requestor: requestor(), inputFile: "in.txt", outputFile: "out.png", format: "png" },
          config,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-input",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed upstream output is typed", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "malformed.mjs", MALFORMED_FIXTURE);
    await writeFile(join(root, "in.png"), PNG_1X1);
    const config = goodConfig(root, exe);
    await assert.rejects(
      () => invokeRaster({ operation: "info", requestor: requestor(), inputFile: "in.png" }, config),
      (error) => error instanceof RasterAdapterError && error.code === "raster/malformed-output",
    );
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "convert", requestor: requestor(), inputFile: "in.png", outputFile: "out.png", format: "png" },
          config,
        ),
      (error) => error instanceof RasterAdapterError && (error.code === "raster/malformed-output" || error.code === "raster/output-limit"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("timeout bounds a hanging executable", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "hang.mjs", HANG_FIXTURE);
    await writeFile(join(root, "in.png"), PNG_1X1);
    const config = goodConfig(root, exe, { timeoutMs: 5_000 });
    const started = Date.now();
    await assert.rejects(
      () =>
        invokeRaster({ operation: "commands", requestor: requestor() }, config, { timeoutMs: 200 }),
      (error) => error instanceof RasterAdapterError && error.code === "raster/timeout",
    );
    assert.ok(Date.now() - started < 5_000, "timeout must bound execution");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("nonzero exit maps to failed with deterministic diagnostics", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "fail.mjs", FAIL_FIXTURE);
    await writeFile(join(root, "in.png"), PNG_1X1);
    const config = goodConfig(root, exe);
    const first = await invokeRaster(
      { operation: "commands", requestor: requestor() },
      config,
    ).then(
      () => null,
      (error) => error,
    );
    assert.ok(first instanceof RasterAdapterError);
    assert.equal(first.code, "raster/failed");
    const second = await invokeRaster(
      { operation: "commands", requestor: requestor() },
      config,
    ).then(
      () => null,
      (error) => error,
    );
    assert.ok(second instanceof RasterAdapterError);
    assert.equal(second.message, first.message);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("caller abort interrupts the child process", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "hang.mjs", HANG_FIXTURE);
    await writeFile(join(root, "in.png"), PNG_1X1);
    const config = goodConfig(root, exe);
    const controller = new AbortController();
    const pending = invokeRaster({ operation: "commands", requestor: requestor() }, config, {
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(
      () => pending,
      (error) => error instanceof RasterAdapterError && error.code === "raster/canceled",
    );
    const already = new AbortController();
    already.abort();
    await assert.rejects(
      () => invokeRaster({ operation: "commands", requestor: requestor() }, config, { signal: already.signal }),
      (error) => error instanceof RasterAdapterError && error.code === "raster/canceled",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("output limits bound files and stdout", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "large.mjs", LARGE_FIXTURE);
    await writeFile(join(root, "in.png"), PNG_1X1);
    const config = goodConfig(root, exe, { maxOutputBytes: 8_192 });
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "convert", requestor: requestor(), inputFile: "in.png", outputFile: "out.png", format: "png" },
          config,
        ),
      (error) => error instanceof RasterAdapterError && (error.code === "raster/output-limit" || error.code === "raster/malformed-output"),
    );
    await assert.rejects(
      () => invokeRaster({ operation: "info", requestor: requestor(), inputFile: "in.png" }, config),
      (error) => error instanceof RasterAdapterError && error.code === "raster/output-limit",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("authorization requires concrete actor and workspace identities", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    const badRequestors = [
      undefined,
      null,
      {},
      { actorId: "", workspaceId: "ws-01" },
      { actorId: "actor-01", workspaceId: "" },
      { actorId: "   ", workspaceId: "ws-01" },
      { actorId: "actor-01; rm", workspaceId: "ws-01" },
    ];
    for (const requestorValue of badRequestors) {
      await assert.rejects(
        () => invokeRaster({ operation: "commands", requestor: requestorValue }, config),
        (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-input",
        JSON.stringify(requestorValue),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("raster bytes validate magic per format and reject mismatches", () => {
  const png = PNG_1X1;
  validateRasterBytes(png, "png", 1024 * 1024);
  const inspected = inspectRaster(png, "png", 1024 * 1024);
  assert.equal(inspected.format, "png");
  assert.equal(inspected.bytes, png.length);
  assert.match(inspected.sha256, /^[a-f0-9]{64}$/);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);
  validateRasterBytes(jpeg, "jpeg", 1024 * 1024);
  validateRasterBytes(jpeg, "jpg", 1024 * 1024);
  assert.throws(
    () => validateRasterBytes(jpeg, "png", 1024 * 1024),
    (error) => error instanceof RasterAdapterError && error.code === "raster/malformed-output",
  );
  assert.throws(
    () => validateRasterBytes(Buffer.alloc(0), "png", 1024 * 1024),
    (error) => error instanceof RasterAdapterError && error.code === "raster/output-limit",
  );
  assert.throws(
    () => validateRasterBytes(Buffer.from("not raster at all"), "png", 1024 * 1024),
    (error) => error instanceof RasterAdapterError && error.code === "raster/malformed-output",
  );
  const webp = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4, 0), Buffer.from("WEBP", "ascii"), Buffer.alloc(16, 2)]);
  validateRasterBytes(webp, "webp", 1024 * 1024);
  const tiff = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(16, 3)]);
  validateRasterBytes(tiff, "tiff", 1024 * 1024);
  validateRasterBytes(tiff, "tif", 1024 * 1024);
  const bmp = Buffer.concat([Buffer.from([0x42, 0x4d]), Buffer.alloc(16, 4)]);
  validateRasterBytes(bmp, "bmp", 1024 * 1024);
});

test("convert refuses to overwrite its input without explicit overwrite", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "convert", requestor: requestor(), inputFile: "in.png", outputFile: "in.png", format: "png" },
          config,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-input",
    );
    const allowed = await invokeRaster(
      {
        operation: "convert",
        requestor: requestor(),
        inputFile: "in.png",
        outputFile: "in.png",
        format: "png",
        overwrite: true,
      },
      config,
    );
    assert.equal(allowed.operation, "convert");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shell metacharacters never reach a shell", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    const marker = join(root, "pwned-marker");
    await assert.rejects(
      () => invokeRaster({ operation: "info", requestor: requestor(), inputFile: "a;touch pwned-marker.png" }, config),
      (error) => error instanceof RasterAdapterError,
    );
    await assert.rejects(
      () =>
        invokeRaster(
          {
            operation: "convert",
            requestor: requestor(),
            inputFile: "in.png",
            outputFile: "out.png",
            format: "png; touch pwned-marker",
          },
          config,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-input",
    );
    await assert.rejects(
      () =>
        invokeRaster(
          {
            operation: "convert",
            requestor: requestor(),
            inputFile: "in.png",
            outputFile: "out.png",
            format: "png",
            quality: 80,
            tiffLayers: "$(touch pwned-marker)",
          },
          config,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/invalid-input",
    );
    let markerExists = true;
    try {
      await readFile(marker);
    } catch {
      markerExists = false;
    }
    assert.equal(markerExists, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scrubbed environment never leaks caller secrets to the child", async () => {
  const root = await makeRoot();
  const previous = process.env.SKILIT_AF11_TEST_SECRET;
  process.env.SKILIT_AF11_TEST_SECRET = "s3cr3t-marker-af11";
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "envdump.mjs", ENV_DUMP_FIXTURE);
    await writeFile(join(root, "in.png"), PNG_1X1);
    const config = goodConfig(root, exe);
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "convert", requestor: requestor(), inputFile: "in.png", outputFile: "env.png", format: "png" },
          config,
        ),
      (error) => error instanceof RasterAdapterError && (error.code === "raster/malformed-output" || error.code === "raster/output-limit"),
    );
    const dumped = await readFile(join(root, "env.png"), "utf8");
    assert.ok(!dumped.includes("s3cr3t-marker-af11"), "child environment must not carry caller secrets");
  } finally {
    if (previous === undefined) delete process.env.SKILIT_AF11_TEST_SECRET;
    else process.env.SKILIT_AF11_TEST_SECRET = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("token swatch to raster convert to reopen filesystem journey", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    const svg = tokensToSvg({
      colors: ["#112233", "#445566"],
      sizes: [12, 16],
      spacing: [8],
      radius: [4],
    });
    await writeFile(join(root, "tokens.svg"), svg);
    const converted = await invokeRaster(
      {
        operation: "convert",
        requestor: requestor(),
        inputFile: "tokens.svg",
        outputFile: "tokens-out.png",
        format: "png",
      },
      config,
    );
    assert.equal(converted.operation, "convert");
    const reopened = await readFile(join(root, "tokens-out.png"));
    const inspected = inspectRaster(reopened, "png", 512 * 1024);
    assert.ok(inspected.bytes > 0);
    const sha = createHash("sha256").update(reopened).digest("hex");
    assert.equal(converted.outputSha256, sha);
    assert.ok((converted.outputBytes ?? 0) > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executable symlinks and directories are unavailable, never executed", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const real = await writeExe(binDir, "real.mjs", GOOD_FIXTURE);
    const link = join(binDir, "link.mjs");
    await symlink(real, link);
    await writeFile(join(root, "in.png"), PNG_1X1);
    const linkConfig = goodConfig(root, link);
    await assert.rejects(
      () => invokeRaster({ operation: "commands", requestor: requestor() }, linkConfig),
      (error) => error instanceof RasterAdapterError && error.code === "raster/unavailable",
    );
    const dirConfig = goodConfig(root, binDir);
    await assert.rejects(
      () => invokeRaster({ operation: "commands", requestor: requestor() }, dirConfig),
      (error) => error instanceof RasterAdapterError && error.code === "raster/unavailable",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("no-model operation and static egress posture", async () => {
  const root = await makeRoot();
  const previousNoModel = process.env.SKILIT_NO_MODEL;
  const previousOpenAI = process.env.OPENAI_API_KEY;
  process.env.SKILIT_NO_MODEL = "1";
  delete process.env.OPENAI_API_KEY;
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    const result = await invokeRaster(
      { operation: "commands", requestor: requestor() },
      config,
    );
    assert.ok(result.provenance.egress === "local");
    const source = await readFile(resolve("packages/editor-adapters/src/raster-adapter.ts"), "utf8");
    const hostA = ["api", "openai", "com"].join(".");
    const hostB = ["api", "anthropic", "com"].join(".");
    assert.ok(!source.toLowerCase().includes(hostA), "adapter must not reference model egress");
    assert.ok(!source.toLowerCase().includes(hostB), "adapter must not reference model egress");
    assert.ok(!source.includes("fetch("), "adapter must not perform network fetch");
    assert.ok(!source.includes("shell: true"), "adapter must never enable a shell");
    assert.ok(source.includes("confined root"), "confinement documented");
    assert.ok(!source.includes("--heif") && !source.includes("photocraft-heif"), "HEIF feature must never be enabled");
  } finally {
    if (previousNoModel === undefined) delete process.env.SKILIT_NO_MODEL;
    else process.env.SKILIT_NO_MODEL = previousNoModel;
    if (previousOpenAI !== undefined) process.env.OPENAI_API_KEY = previousOpenAI;
    await rm(root, { recursive: true, force: true });
  }
});

test("unsafe raster payload fails closed on convert", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "unsafe.mjs", UNSAFE_FIXTURE);
    await writeFile(join(root, "in.png"), PNG_1X1);
    const config = goodConfig(root, exe);
    await assert.rejects(
      () =>
        invokeRaster(
          { operation: "convert", requestor: requestor(), inputFile: "in.png", outputFile: "evil.png", format: "png" },
          config,
        ),
      (error) => error instanceof RasterAdapterError && error.code === "raster/malformed-output",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real binary contract uses execFile without a shell", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const resolvedExe = resolve(exe);
    await new Promise((resolvePromise, rejectPromise) => {
      execFile(resolvedExe, ["commands"], { timeout: 5_000 }, (error, stdout) => {
        if (error) rejectPromise(error);
        else {
          assert.ok(String(stdout).includes("convert"));
          resolvePromise(undefined);
        }
      });
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
