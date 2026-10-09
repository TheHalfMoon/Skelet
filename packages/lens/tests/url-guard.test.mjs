import assert from "node:assert/strict";
import test from "node:test";

import {
  LENS_LIMITS,
  LensError,
  guardRedirectTarget,
  guardResolvedIps,
  validateCaptureUrl,
} from "../src/url-guard.ts";

function fakeResolver(mapping) {
  return {
    resolve: async (hostname) => {
      if (!Object.hasOwn(mapping, hostname)) throw new Error(`no fixture DNS for ${hostname}`);
      return mapping[hostname];
    },
  };
}

test("public URLs validate with canonical href", () => {
  const validated = validateCaptureUrl("https://example.org:8443/paths?q=1");
  assert.equal(validated.hostname, "example.org");
  assert.ok(validated.href.startsWith("https://example.org:8443/"));
  assert.equal(validateCaptureUrl("http://example.org/").hostname, "example.org");
});

test("loopback and private literals fail closed", () => {
  for (const url of [
    "http://localhost/",
    "http://localhost:3000/",
    "http://127.0.0.1/",
    "http://127.1.2.3:8080/x",
    "http://10.0.0.5/",
    "http://172.16.4.9/",
    "http://172.31.255.1/",
    "http://192.168.1.20/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
    "http://[ff02::1]/",
    "http://0.0.0.0/",
    "http://224.0.0.1/",
    "http://999.1.1.1/",
  ]) {
    assert.throws(() => validateCaptureUrl(url), (error) => error instanceof LensError, url);
  }
  assert.equal(
    ((() => { try { validateCaptureUrl("http://10.1.2.3/"); } catch (error) { return error.code; } })()),
    "lens/blocked-host",
  );
});

test("special-use names and metadata endpoints fail closed", () => {
  for (const url of [
    "http://myhost.local/",
    "http://printer.internal/",
    "http://metadata.google.internal/",
    "http://service.invalid/",
    "http://demo.example/",
    "http://app.test/",
  ]) {
    assert.throws(() => validateCaptureUrl(url), LensError, url);
  }
});

test("unsupported schemes and credentials fail closed", () => {
  for (const [url, code] of [
    ["file:///etc/passwd", "lens/unsupported-scheme"],
    ["data:text/html,<h1>x</h1>", "lens/unsupported-scheme"],
    ["javascript:alert(1)", "lens/unsupported-scheme"],
    ["ftp://example.org/x", "lens/unsupported-scheme"],
    ["https://user:pass@example.org/", "lens/invalid-url"],
    ["https://user@example.org/", "lens/invalid-url"],
    ["not a url", "lens/invalid-url"],
    ["", "lens/invalid-url"],
    [`https://example.org/${"x".repeat(2048)}`, "lens/invalid-url"],
  ]) {
    try {
      validateCaptureUrl(url);
      assert.fail(`must reject: ${url}`);
    } catch (error) {
      assert.ok(error instanceof LensError);
      assert.equal(error.code, code);
    }
  }
});

test("resolved addresses gate every answer", () => {
  guardResolvedIps(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
  for (const ips of [
    ["93.184.216.34", "10.9.9.9"],
    ["::ffff:192.168.0.5"],
    ["fe80::dead:beef"],
  ]) {
    assert.throws(() => guardResolvedIps(ips), LensError);
  }
  assert.throws(() => guardResolvedIps([]), LensError);
});

test("redirect targets revalidate under budget", async () => {
  const resolver = fakeResolver({
    "example.org": ["93.184.216.34"],
    "evil.example": ["192.168.9.9"],
  });
  const first = await guardRedirectTarget("https://example.org/a", 0, resolver);
  assert.equal(first.hostname, "example.org");
  await assert.rejects(
    guardRedirectTarget("https://evil.example/b", 1, resolver),
    (error) => error instanceof LensError && error.code === "lens/blocked-host",
  );
  await assert.rejects(
    guardRedirectTarget("https://example.org/c", LENS_LIMITS.maxRedirectHops, resolver),
    (error) => error instanceof LensError && error.code === "lens/blocked-host",
  );
  await assert.rejects(
    guardRedirectTarget("http://10.2.3.4/", 0, resolver),
    (error) => error instanceof LensError,
  );
});
