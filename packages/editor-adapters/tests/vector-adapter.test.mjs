import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  VECTORCRAFT_PIN,
  VectorAdapterError,
  inspectSvg,
  invokeVector,
  tokensToSvg,
  validateSvgOutput,
  validateVectorAdapterConfig,
  vectorAvailability,
  vectorHealth,
} from "../src/vector-adapter.ts";

const GOOD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect x="0" y="0" width="48" height="48" fill="#ff0000"/></svg>\n`;

function goodConfig(rootDir, executablePath, overrides = {}) {
  return {
    enabled: true,
    executablePath,
    rootDir,
    timeoutMs: 5_000,
    maxOutputBytes: 512 * 1024,
    versionPin: VECTORCRAFT_PIN,
    ...overrides,
  };
}

function requestor() {
  return { actorId: "actor-01", workspaceId: "ws-01" };
}

async function makeRoot() {
  const dir = await mkdtemp(join(tmpdir(), "skelet-af10-"));
  return dir;
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
if (args[0] === "commands") {
  console.log(JSON.stringify({ commands: ["convert", "info", "commands"] }));
  process.exit(0);
}
if (args[0] === "info") {
  const data = readFileSync(args[1]);
  console.log(JSON.stringify({ bytes: data.length }));
  process.exit(0);
}
if (args[0] === "convert") {
  const data = readFileSync(args[1]);
  writeFileSync(args[2], data);
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
  writeFileSync(args[2], "definitely not svg");
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
  writeFileSync(args[2], Buffer.alloc(256 * 1024, "x"));
  process.exit(0);
}
if (args[0] === "info" || args[0] === "commands") {
  console.log(JSON.stringify({ blob: "x".repeat(256 * 1024) }));
  process.exit(0);
}
process.exit(2);
`;

const SCRIPT_OUTPUT_FIXTURE = `
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "convert") {
  writeFileSync(args[2], '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
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
  const exe = await writeExe(binDir, "fake-vectorcraft.mjs", GOOD_FIXTURE);
  await writeFile(join(root, "in.svg"), GOOD_SVG);
  return exe;
}

test("disabled-by-default without explicit opt-in", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "fake.mjs", GOOD_FIXTURE);
    await writeFile(join(root, "in.svg"), GOOD_SVG);
    const disabled = {
      enabled: false,
      executablePath: exe,
      rootDir: root,
      versionPin: VECTORCRAFT_PIN,
    };
    await assert.rejects(
      () =>
        invokeVector(
          { operation: "commands", requestor: requestor() },
          disabled,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/disabled",
    );
    const implicit = { rootDir: root };
    await assert.rejects(
      () =>
        invokeVector(
          { operation: "commands", requestor: requestor() },
          implicit,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/disabled",
    );
    const availability = await vectorAvailability(disabled);
    assert.equal(availability.available, false);
    assert.equal(availability.reason, "disabled");
    const health = await vectorHealth(disabled);
    assert.equal(health.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing executable fails as unavailable", async () => {
  const root = await makeRoot();
  try {
    await writeFile(join(root, "in.svg"), GOOD_SVG);
    const config = goodConfig(root, join(root, "bin", "does-not-exist.mjs"));
    await assert.rejects(
      () => invokeVector({ operation: "commands", requestor: requestor() }, config),
      (error) => error instanceof VectorAdapterError && error.code === "vector/unavailable",
    );
    const availability = await vectorAvailability(config);
    assert.equal(availability.available, false);
    assert.equal(availability.reason, "unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("valid opt-in configuration converts, infos, and lists commands", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    const availability = await vectorAvailability(config);
    assert.equal(availability.available, true);
    const health = await vectorHealth(config);
    assert.equal(health.ok, true);

    const converted = await invokeVector(
      {
        operation: "convert",
        requestor: requestor(),
        inputFile: "in.svg",
        outputFile: "out.svg",
      },
      config,
    );
    assert.equal(converted.operation, "convert");
    assert.ok((converted.outputFile ?? "").endsWith("out.svg"));
    assert.ok((converted.outputBytes ?? 0) > 0);
    assert.match(converted.outputSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(converted.provenance.adapterId, "vectorcraft-local");
    assert.equal(converted.provenance.capability, "vector-export");
    assert.equal(converted.provenance.version, VECTORCRAFT_PIN);
    assert.equal(converted.provenance.egress, "local");
    assert.equal(converted.provenance.costClass, "free-local");
    const outBytes = await readFile(join(root, "out.svg"), "utf8");
    assert.equal(outBytes, GOOD_SVG);

    const info = await invokeVector(
      { operation: "info", requestor: requestor(), inputFile: "in.svg" },
      config,
    );
    assert.deepEqual(info.stdoutJson, { bytes: Buffer.byteLength(GOOD_SVG) });

    const commands = await invokeVector(
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
    await writeFile(join(root, "in.svg"), GOOD_SVG);
    const cases = [
      { enabled: true, executablePath: "relative/path", rootDir: root, versionPin: VECTORCRAFT_PIN },
      { enabled: true, executablePath: exe, rootDir: "relative/root", versionPin: VECTORCRAFT_PIN },
      { enabled: true, executablePath: exe, rootDir: root, versionPin: "deadbeef".repeat(5).slice(0, 40) },
      { enabled: true, executablePath: exe, rootDir: root, versionPin: VECTORCRAFT_PIN, timeoutMs: 0 },
      { enabled: true, executablePath: exe, rootDir: root, versionPin: VECTORCRAFT_PIN, timeoutMs: 999_999 },
      { enabled: true, executablePath: exe, rootDir: root, versionPin: VECTORCRAFT_PIN, maxOutputBytes: 10 },
    ];
    for (const bad of cases) {
      assert.throws(() => validateVectorAdapterConfig(bad), (error) => error instanceof VectorAdapterError && error.code === "vector/invalid-config", JSON.stringify(bad));
    }
    // Missing root passes syntax validation but fails closed at invocation.
    await assert.rejects(
      () =>
        invokeVector(
          { operation: "commands", requestor: requestor() },
          { enabled: true, executablePath: exe, rootDir: join(root, "missing-root"), versionPin: VECTORCRAFT_PIN },
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/invalid-config",
    );
    // Root that is a file, not a directory.
    const fileAsRoot = join(root, "in.svg");
    await assert.rejects(
      () => invokeVector({ operation: "commands", requestor: requestor() }, goodConfig(fileAsRoot, exe)),
      (error) => error instanceof VectorAdapterError && (error.code === "vector/invalid-config" || error.code === "vector/unavailable"),
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
        invokeVector(
          { operation: "info", requestor: requestor(), inputFile: "/etc/passwd" },
          config,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/path-escape",
    );
    await assert.rejects(
      () =>
        invokeVector(
          {
            operation: "convert",
            requestor: requestor(),
            inputFile: "in.svg",
            outputFile: "/tmp/af10-outside.svg",
          },
          config,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/path-escape",
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
    for (const evil of ["../outside.svg", "a/../../outside.svg", "sub/../../../etc/passwd"]) {
      await assert.rejects(
        () => invokeVector({ operation: "info", requestor: requestor(), inputFile: evil }, config),
        (error) => error instanceof VectorAdapterError && (error.code === "vector/path-escape" || error.code === "vector/invalid-input"),
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
    await writeFile(join(outside, "secret.svg"), GOOD_SVG);
    await symlink(join(outside, "secret.svg"), join(root, "link.svg"));
    await mkdir(join(root, "realdir"), { recursive: true });
    await symlink(outside, join(root, "linkdir"));
    const config = goodConfig(root, exe);
    await assert.rejects(
      () => invokeVector({ operation: "info", requestor: requestor(), inputFile: "link.svg" }, config),
      (error) => error instanceof VectorAdapterError && error.code === "vector/path-escape",
    );
    await assert.rejects(
      () =>
        invokeVector(
          {
            operation: "convert",
            requestor: requestor(),
            inputFile: "in.svg",
            outputFile: "linkdir/evil.svg",
          },
          config,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/path-escape",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("unsupported operations and inputs fail with stable contracts", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    for (const operation of ["run", "mcp", "bench", "perf", "delete"]) {
      await assert.rejects(
        () => invokeVector({ operation, requestor: requestor(), inputFile: "in.svg" }, config),
        (error) => error instanceof VectorAdapterError && (error.code === "vector/unsupported-operation" || error.code === "vector/invalid-input"),
        String(operation),
      );
    }
    await assert.rejects(
      () =>
        invokeVector(
          { operation: "convert", requestor: requestor(), inputFile: "in.svg", outputFile: "out.svg", scale: 0 },
          config,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/invalid-input",
    );
    await assert.rejects(
      () =>
        invokeVector(
          { operation: "convert", requestor: requestor(), inputFile: "in.svg", outputFile: "out.svg", scale: 99 },
          config,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/invalid-input",
    );
    await assert.rejects(
      () =>
        invokeVector(
          { operation: "convert", requestor: requestor(), inputFile: "in.svg", outputFile: "out.svg", artboard: 1, range: "1-2" },
          config,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/invalid-input",
    );
    await assert.rejects(
      () =>
        invokeVector(
          { operation: "convert", requestor: requestor(), inputFile: "in.svg", outputFile: "out.svg", range: "1; rm -rf /" },
          config,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/invalid-input",
    );
    await assert.rejects(
      () => invokeVector({ operation: "info", requestor: requestor(), inputFile: "in.svg", outputFile: "out.svg" }, config),
      (error) => error instanceof VectorAdapterError && error.code === "vector/invalid-input",
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
    await writeFile(join(root, "in.svg"), GOOD_SVG);
    const config = goodConfig(root, exe);
    await assert.rejects(
      () => invokeVector({ operation: "info", requestor: requestor(), inputFile: "in.svg" }, config),
      (error) => error instanceof VectorAdapterError && error.code === "vector/malformed-output",
    );
    await assert.rejects(
      () =>
        invokeVector(
          { operation: "convert", requestor: requestor(), inputFile: "in.svg", outputFile: "out.svg" },
          config,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/malformed-output",
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
    await writeFile(join(root, "in.svg"), GOOD_SVG);
    const config = goodConfig(root, exe, { timeoutMs: 5_000 });
    const started = Date.now();
    await assert.rejects(
      () =>
        invokeVector({ operation: "commands", requestor: requestor() }, config, { timeoutMs: 200 }),
      (error) => error instanceof VectorAdapterError && error.code === "vector/timeout",
    );
    assert.ok(Date.now() - started < 5_000, "timeout must bound execution");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("nonzero exit maps to failed with truncated diagnostics", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "fail.mjs", FAIL_FIXTURE);
    await writeFile(join(root, "in.svg"), GOOD_SVG);
    const config = goodConfig(root, exe);
    const first = await invokeVector(
      { operation: "commands", requestor: requestor() },
      config,
    ).then(
      () => null,
      (error) => error,
    );
    assert.ok(first instanceof VectorAdapterError);
    assert.equal(first.code, "vector/failed");
    const second = await invokeVector(
      { operation: "commands", requestor: requestor() },
      config,
    ).then(
      () => null,
      (error) => error,
    );
    assert.ok(second instanceof VectorAdapterError);
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
    await writeFile(join(root, "in.svg"), GOOD_SVG);
    const config = goodConfig(root, exe);
    const controller = new AbortController();
    const pending = invokeVector({ operation: "commands", requestor: requestor() }, config, {
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(
      () => pending,
      (error) => error instanceof VectorAdapterError && error.code === "vector/canceled",
    );
    const already = new AbortController();
    already.abort();
    await assert.rejects(
      () => invokeVector({ operation: "commands", requestor: requestor() }, config, { signal: already.signal }),
      (error) => error instanceof VectorAdapterError && error.code === "vector/canceled",
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
    await writeFile(join(root, "in.svg"), GOOD_SVG);
    const config = goodConfig(root, exe, { maxOutputBytes: 8_192 });
    await assert.rejects(
      () =>
        invokeVector(
          { operation: "convert", requestor: requestor(), inputFile: "in.svg", outputFile: "out.svg" },
          config,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/output-limit",
    );
    await assert.rejects(
      () => invokeVector({ operation: "info", requestor: requestor(), inputFile: "in.svg" }, config),
      (error) => error instanceof VectorAdapterError && error.code === "vector/output-limit",
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
        () => invokeVector({ operation: "commands", requestor: requestorValue }, config),
        (error) => error instanceof VectorAdapterError && error.code === "vector/invalid-input",
        JSON.stringify(requestorValue),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("token swatches are deterministic and bounded", () => {
  const input = {
    colors: ["#00ff00", "#ff0000", "#0000ff"],
    sizes: [16, 8],
    spacing: [4],
    radius: [2],
  };
  const first = tokensToSvg(input);
  const reordered = tokensToSvg({
    colors: ["#0000ff", "#00ff00", "#ff0000"],
    sizes: [8, 16],
    spacing: [4],
    radius: [2],
  });
  assert.equal(first, reordered);
  const sha = createHash("sha256").update(first).digest("hex");
  assert.match(sha, /^[a-f0-9]{64}$/);
  const inspected = inspectSvg(first);
  assert.ok(inspected.width > 0 && inspected.height > 0 && inspected.shapes > 0);
  assert.throws(() => tokensToSvg({ colors: ["red"], sizes: [], spacing: [], radius: [] }), (error) => error instanceof VectorAdapterError);
  assert.throws(
    () => tokensToSvg({ colors: Array(25).fill("#ffffff"), sizes: [], spacing: [], radius: [] }),
    (error) => error instanceof VectorAdapterError,
  );
});

test("SVG validation rejects active content", () => {
  assert.throws(
    () => validateSvgOutput('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>', 1024),
    (error) => error instanceof VectorAdapterError && error.code === "vector/malformed-output",
  );
  assert.throws(
    () => validateSvgOutput('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="5" onload="evil()"/></svg>', 2048),
    (error) => error instanceof VectorAdapterError && error.code === "vector/malformed-output",
  );
  assert.throws(
    () => validateSvgOutput('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><a href="javascript:evil()">x</a></svg>', 2048),
    (error) => error instanceof VectorAdapterError && error.code === "vector/malformed-output",
  );
  assert.throws(
    () => validateSvgOutput('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><foreignObject><div>x</div></foreignObject></svg>', 4096),
    (error) => error instanceof VectorAdapterError && error.code === "vector/malformed-output",
  );
});

test("convert refuses to overwrite its input without an explicit flag", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    await assert.rejects(
      () =>
        invokeVector(
          { operation: "convert", requestor: requestor(), inputFile: "in.svg", outputFile: "in.svg" },
          config,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/invalid-input",
    );
    const allowed = await invokeVector(
      {
        operation: "convert",
        requestor: requestor(),
        inputFile: "in.svg",
        outputFile: "in.svg",
        replaceLossy: true,
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
      () => invokeVector({ operation: "info", requestor: requestor(), inputFile: "a;touch pwned-marker.svg" }, config),
      (error) => error instanceof VectorAdapterError,
    );
    await assert.rejects(
      () =>
        invokeVector(
          {
            operation: "convert",
            requestor: requestor(),
            inputFile: "in.svg",
            outputFile: "out.svg",
            range: "$(touch pwned-marker)",
          },
          config,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/invalid-input",
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
  const previous = process.env.SKELET_AF10_TEST_SECRET;
  process.env.SKELET_AF10_TEST_SECRET = "s3cr3t-marker-af10";
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "envdump.mjs", ENV_DUMP_FIXTURE);
    await writeFile(join(root, "in.svg"), GOOD_SVG);
    const config = goodConfig(root, exe);
    const result = await invokeVector(
      { operation: "convert", requestor: requestor(), inputFile: "in.svg", outputFile: "env.json" },
      config,
    );
    assert.equal(result.operation, "convert");
    const dumped = await readFile(join(root, "env.json"), "utf8");
    assert.ok(!dumped.includes("s3cr3t-marker-af10"), "child environment must not carry caller secrets");
  } finally {
    if (previous === undefined) delete process.env.SKELET_AF10_TEST_SECRET;
    else process.env.SKELET_AF10_TEST_SECRET = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("token to SVG to convert to reopen filesystem journey", async () => {
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
    const converted = await invokeVector(
      {
        operation: "convert",
        requestor: requestor(),
        inputFile: "tokens.svg",
        outputFile: "tokens-out.svg",
      },
      config,
    );
    assert.equal(converted.operation, "convert");
    const reopened = await readFile(join(root, "tokens-out.svg"), "utf8");
    const inspected = inspectSvg(reopened);
    assert.ok(inspected.shapes >= 3);
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
    await writeFile(join(root, "in.svg"), GOOD_SVG);
    const linkConfig = goodConfig(root, link);
    await assert.rejects(
      () => invokeVector({ operation: "commands", requestor: requestor() }, linkConfig),
      (error) => error instanceof VectorAdapterError && error.code === "vector/unavailable",
    );
    const dirConfig = goodConfig(root, binDir);
    await assert.rejects(
      () => invokeVector({ operation: "commands", requestor: requestor() }, dirConfig),
      (error) => error instanceof VectorAdapterError && error.code === "vector/unavailable",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("no-model operation and static egress posture", async () => {
  const root = await makeRoot();
  const previousNoModel = process.env.SKELET_NO_MODEL;
  const previousOpenAI = process.env.OPENAI_API_KEY;
  process.env.SKELET_NO_MODEL = "1";
  delete process.env.OPENAI_API_KEY;
  try {
    const exe = await setupGood(root);
    const config = goodConfig(root, exe);
    const result = await invokeVector(
      { operation: "commands", requestor: requestor() },
      config,
    );
    assert.ok(result.provenance.egress === "local");
    const source = await readFile(resolve("packages/editor-adapters/src/vector-adapter.ts"), "utf8");
    const hostA = ["api", "openai", "com"].join(".");
    const hostB = ["api", "anthropic", "com"].join(".");
    assert.ok(!source.toLowerCase().includes(hostA), "adapter must not reference model egress");
    assert.ok(!source.toLowerCase().includes(hostB), "adapter must not reference model egress");
    assert.ok(!source.includes("fetch("), "adapter must not perform network fetch");
    assert.ok(!source.includes("child_process") || source.includes("execFile"), "only allowlisted subprocess");
    assert.ok(!source.includes("shell: true"), "adapter must never enable a shell");
    assert.ok(source.includes("--automation-read-root") || source.includes("confined root"), "confinement documented");
  } finally {
    if (previousNoModel === undefined) delete process.env.SKELET_NO_MODEL;
    else process.env.SKELET_NO_MODEL = previousNoModel;
    if (previousOpenAI !== undefined) process.env.OPENAI_API_KEY = previousOpenAI;
    await rm(root, { recursive: true, force: true });
  }
});

test("script-bearing upstream SVG fails closed on convert", async () => {
  const root = await makeRoot();
  try {
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const exe = await writeExe(binDir, "scriptout.mjs", SCRIPT_OUTPUT_FIXTURE);
    await writeFile(join(root, "in.svg"), GOOD_SVG);
    const config = goodConfig(root, exe);
    await assert.rejects(
      () =>
        invokeVector(
          { operation: "convert", requestor: requestor(), inputFile: "in.svg", outputFile: "evil.svg" },
          config,
        ),
      (error) => error instanceof VectorAdapterError && error.code === "vector/malformed-output",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real binary contract uses execFile without a shell", async () => {
  const root = await makeRoot();
  try {
    const exe = await setupGood(root);
    const resolved = resolve(exe);
    await new Promise((resolvePromise, rejectPromise) => {
      execFile(resolved, ["commands"], { timeout: 5_000 }, (error, stdout) => {
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
