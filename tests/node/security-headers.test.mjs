import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../../apps/web/next.config.ts";

test("browser security headers apply to every web route", async () => {
  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, "/:path*");
  const entries = Object.fromEntries(rules[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(entries["x-frame-options"], "DENY");
  assert.equal(entries["x-content-type-options"], "nosniff");
  assert.equal(entries["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(entries["permissions-policy"], "camera=(), microphone=(), geolocation=()");
  assert.match(entries["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(entries["content-security-policy"], /base-uri 'self'/);
  assert.match(entries["content-security-policy"], /object-src 'none'/);
  assert.doesNotMatch(entries["content-security-policy"], /script-src/);
});
