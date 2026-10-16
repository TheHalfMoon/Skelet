import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = dirname(require.resolve("../../package.json"));
const BUILDER = join(repoRoot, "scripts", "build_release_candidate.mjs");

function build(args) {
  const out = mkdtempSync(join(tmpdir(), "skilit-rc-"));
  const proc = spawnSync(process.execPath, [BUILDER, "--out", out, ...args], {
    encoding: "utf8",
    timeout: 300000,
  });
  return { out, proc };
}

test("RC builder produces a verifiable tarball plus manifest plus checksums", () => {
  const { out, proc } = build(["--version", "v1.0.0-local-rc.1"]);
  assert.equal(proc.status, 0, `builder must exit zero (stderr: ${(proc.stderr ?? "").slice(0, 500)})`);
  const payload = JSON.parse(proc.stdout);
  assert.equal(payload.ok, true);
  assert.match(payload.tarball, /^skilit-v1\.0\.0-local-rc\.1-[0-9a-f]{7}\.tar\.gz$/);
  const tarballPath = join(out, payload.tarball);
  assert.ok(existsSync(tarballPath), "tarball exists");
  const recomputed = createHash("sha256").update(readFileSync(tarballPath)).digest("hex");
  assert.equal(payload.tarball_sha256, recomputed, "reported digest matches bytes");
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.equal(manifest.signed, false, "candidate is explicitly unsigned");
  assert.equal(manifest.artifacts.tarball_sha256, recomputed);
  assert.ok(manifest.files > 900, "manifest records the file inventory");
  const sums = readFileSync(join(out, "SHA256SUMS"), "utf8");
  assert.ok(sums.includes(payload.tarball), "checksums cover the tarball");
  assert.ok(sums.includes(payload.tarball_sha256), "checksums carry the digest");
  rmSync(out, { recursive: true, force: true });
});

test("RC builder refuses missing output and unsafe versions", () => {
  const missing = spawnSync(process.execPath, [BUILDER], { encoding: "utf8", timeout: 60000 });
  assert.equal(missing.status, 2, "missing --out must exit 2");
  const { out, proc } = build(["--version", "../evil"]);
  assert.equal(proc.status, 2, "unsafe version must exit 2");
  rmSync(out, { recursive: true, force: true });
});
