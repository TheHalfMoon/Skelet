import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CAPTURE_BUDGET, CaptureError, fetchGuardedHtml,
} from "../src/capture-network.ts";
import { isolatedWorkerEnv, capturePublicPage } from "../src/capture-worker.ts";

const html = (s = "<html><title>Fixture</title></html>") => new TextEncoder().encode(s);
const okay = (body = html()) => ({ status: 200, headers: { "content-type": "text/html" }, body });
const resolver = (mapping) => ({
  async resolve(host) {
    if (!Object.hasOwn(mapping, host)) throw new Error("fixture DNS missing");
    const answers = mapping[host];
    return typeof answers === "function" ? answers() : answers;
  },
});

test("guard pins a public IP for transport and reports stable source hash", async () => {
  const calls = [];
  const transport = { async get(href, ip, ms) {
    calls.push({ href, ip, ms });
    return okay();
  } };
  const source = await fetchGuardedHtml(
    "https://example.org/", resolver({ "example.org": ["93.184.216.34"] }), transport,
  );
  assert.equal(source.href, "https://example.org/");
  assert.equal(source.redirects, 0);
  assert.equal(source.byteCount, html().length);
  assert.match(source.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(calls.map(({ href, ip }) => ({ href, ip })), [
    { href: "https://example.org/", ip: "93.184.216.34" },
  ]);
  assert.ok(calls[0].ms <= CAPTURE_BUDGET.networkMs);
});

test("private DNS answer is denied before HTTP invocation", async () => {
  let called = false;
  const transport = { async get() { called = true; return okay(); } };
  await assert.rejects(
    fetchGuardedHtml("https://example.org/", resolver({
      "example.org": ["93.184.216.34", "169.254.169.254"],
    }), transport),
  );
  assert.equal(called, false);
});

test("redirect to metadata / private IP is rejected before the second HTTP invocation", async () => {
  let count = 0;
  const transport = { async get() {
    count++;
    return { status: 302, headers: { location: "https://metadata.google.internal/latest" }, body: html("") };
  } };
  await assert.rejects(fetchGuardedHtml(
    "https://example.org/", resolver({ "example.org": ["93.184.216.34"] }), transport,
  ));
  assert.equal(count, 1);
});

test("redirect rebind is checked on each hop, not just the first", async () => {
  let dnsQueries = 0;
  let requests = 0;
  const rotating = resolver({
    "example.org": () => (++dnsQueries === 1 ? ["93.184.216.34"] : ["10.0.0.4"]),
  });
  const transport = { async get() {
    requests++;
    return { status: 302, headers: { location: "/next" }, body: html("") };
  } };
  await assert.rejects(fetchGuardedHtml("https://example.org/", rotating, transport));
  assert.equal(dnsQueries, 2);
  assert.equal(requests, 1);
});

test("redirect loop, redirect-budget and oversized bodies fail closed", async () => {
  const dns = resolver({ "example.org": ["93.184.216.34"] });
  const loop = { async get() {
    return { status: 302, headers: { location: "/same" }, body: html("") };
  } };
  await assert.rejects(fetchGuardedHtml("https://example.org/same", dns, loop),
    (e) => e instanceof CaptureError && e.code === "capture/blocked");

  let n = 0;
  const hopLimit = { async get() {
    n++;
    return { status: 302, headers: { location: `/next-${n}` }, body: html("") };
  } };
  await assert.rejects(fetchGuardedHtml("https://example.org/", dns, hopLimit));
  assert.equal(n, CAPTURE_BUDGET.maxRedirects + 1);

  const huge = { async get() { return okay(new Uint8Array(CAPTURE_BUDGET.maxHtmlBytes + 1)); } };
  await assert.rejects(fetchGuardedHtml("https://example.org/", dns, huge),
    (e) => e instanceof CaptureError && e.code === "capture/too-large");
});

test("deadline, incorrect mime and compressed responses reject", async () => {
  const dns = resolver({ "example.org": ["93.184.216.34"] });
  let count = 0;
  await assert.rejects(fetchGuardedHtml("https://example.org/", dns, {
    async get() { count++; return okay(); },
  }, () => ++count === 1 ? 0 : 12_001), (e) => e.code === "capture/timeout");
  assert.equal(count, 2); // clock only, HTTP never called
  for (const headers of [
    { "content-type": "application/octet-stream" },
    { "content-type": "text/html", "content-encoding": "gzip" },
  ]) {
    await assert.rejects(fetchGuardedHtml("https://example.org/", dns, {
      async get() { return { status: 200, headers, body: html() }; },
    }), (e) => e.code === "capture/unsupported");
  }
});

test("child-process environment is actually secret-free", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skelet-lens-env-"));
  const fixture = join(dir, "probe.cjs");
  const original = process.env.SKELET_PRIVATE_CLOUD_KEY;
  try {
    process.env.SKELET_PRIVATE_CLOUD_KEY = "SECRET_DO_NOT_COPY";
    writeFileSync(fixture, `process.send({ env: process.env });\n`);
    const got = await new Promise((resolve, reject) => {
      const child = fork(fixture, [], {
        env: isolatedWorkerEnv(dir),
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      child.on("message", resolve);
      child.on("error", reject);
    });
    assert.equal(got.env.SKELET_PRIVATE_CLOUD_KEY, undefined);
    assert.equal(got.env.NODE_OPTIONS, undefined);
    assert.equal(got.env.GITHUB_TOKEN, undefined);
    assert.equal(got.env.HOME, dir);
    assert.equal(got.env.PLAYWRIGHT_BROWSERS_PATH, isolatedWorkerEnv(dir).PLAYWRIGHT_BROWSERS_PATH);
    assert.notEqual(got.env.PLAYWRIGHT_BROWSERS_PATH, dir);
    assert.deepEqual(Object.keys(got.env).filter((key) => key !== "__CF_USER_TEXT_ENCODING").sort(), [
      "HOME", "LANG", "LC_ALL", "PATH", "PLAYWRIGHT_BROWSERS_PATH", "TEMP", "TMP", "TMPDIR", "TZ",
    ]);
  } finally {
    if (original === undefined) delete process.env.SKELET_PRIVATE_CLOUD_KEY;
    else process.env.SKELET_PRIVATE_CLOUD_KEY = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("malicious URL is refused before child spawn", async () => {
  await assert.rejects(capturePublicPage("http://127.0.0.1/"), (e) => e.code === "lens/blocked-host");
  await assert.rejects(capturePublicPage("file:///etc/passwd"), (e) => e.code === "lens/unsupported-scheme");
});

test("aggregate redirect-body bytes cannot bypass the download budget", async () => {
  const dns = resolver({ "example.org": ["93.184.216.34"] });
  let hits = 0;
  const transport = { async get(_href, _ip, _ms, remaining) {
    hits++;
    assert.ok(remaining <= CAPTURE_BUDGET.maxHtmlBytes);
    return { status: 302, headers: { location: `/hop-${hits}` },
      body: new Uint8Array(600_000) };
  } };
  await assert.rejects(fetchGuardedHtml("https://example.org/", dns, transport),
    (e) => e.code === "capture/too-large");
  assert.equal(hits, 2);
});

test("system resolver handles public IPv6 literals without DNS rebinding", async () => {
  const { systemDns } = await import("../src/capture-network.ts");
  assert.deepEqual(await systemDns.resolve("[2606:2800:220:1:248:1893:25c8:1946]"),
    ["2606:2800:220:1:248:1893:25c8:1946"]);
});
