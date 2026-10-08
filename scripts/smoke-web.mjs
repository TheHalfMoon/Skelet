/** Production startup smoke: `node scripts/smoke-web.mjs [--port N]`.
 * Spawns `pnpm --dir apps/web start`, polls /api/health until 200,
 * asserts the health contract plus `/` 200, then shuts the server down.
 * Exit non-zero on any failure. */
import { spawn } from "node:child_process";
import process from "node:process";

const port = Number(process.env.SMOKE_PORT ?? process.argv[2] ?? 3103);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`SMOKE_FAIL invalid port: ${process.argv[2] ?? ""}`);
  process.exit(2);
}
const base = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 90_000;

const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
  {
    cwd: new URL("../apps/web/", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.on("data", (chunk) => process.stdout.write(`[web] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[web] ${chunk}`));

let failed = null;
let serverExited = false;
server.on("exit", (code) => {
  serverExited = true;
  if (code !== 0 && code !== null) {
    console.error(`[web] server exited early with code ${code}`);
  }
});
async function poll(path) {
  for (;;) {
    if (serverExited) {
      throw new Error(`server exited before ${path} responded`);
    }
    try {
      const response = await fetch(base + path);
      return response;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${path}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

try {
  const health = await poll("/api/health");
  if (health.status !== 200) {
    throw new Error(`expected /api/health 200, got ${health.status}`);
  }
  const payload = await health.json();
  if (payload.status !== "ok" || payload.service !== "skelet-web") {
    throw new Error(`health contract violated: ${JSON.stringify(payload)}`);
  }
  if (typeof payload.version !== "string" || payload.version.length === 0) {
    throw new Error(`health version violated: ${JSON.stringify(payload)}`);
  }
  const index = await fetch(`${base}/`);
  if (index.status !== 200) {
    throw new Error(`expected / 200, got ${index.status}`);
  }
  const html = await index.text();
  if (!html.includes("Skelet")) {
    throw new Error("landing page does not identify Skelet");
  }
  console.log("SMOKE_OK", JSON.stringify(payload));
} catch (error) {
  failed = error;
  console.error(`SMOKE_FAIL ${error.message}`);
} finally {
  server.kill("SIGTERM");
  setTimeout(() => server.kill("SIGKILL"), 5000).unref();
}
process.exitCode = failed ? 1 : 0;
