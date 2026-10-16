/**
 * P15-3 release-artifact signing procedure (Skelet-owned, no-prod-dependency).
 *
 * Implements the operator signing ceremony for release artifacts (SBOM,
 * build manifests, starter kits) as an executable script with two modes:
 *
 * 1. Operator mode: detached-signs an artifact with an operator-owned GPG
 *    key and verifies the signature in the same invocation (fail-closed:
 *    a signature that does not verify is never written as success).
 *      node scripts/sign_release_artifact.mjs --artifact <file> --key <fingerprint> [--output <sig.asc>]
 *
 * 2. Self-test mode: proves the procedure end-to-end with an ephemeral
 *    GNUPGHOME, an ephemeral ed25519 key, and a fixture payload, then
 *    removes all key material. No secret is read, stored, or printed.
 *      node scripts/sign_release_artifact.mjs --self-test
 *
 * Test signatures prove the procedure, never a production release
 * identity: production keys are owner-controlled under a key ceremony
 * this repo does not perform. See docs/operations/RELEASE_SIGNING.md.
 *
 * Exit codes: 0 signed-and-verified (or self-test passed), 1 signature
 * failed verification, 2 invalid input, 3 signing tool unavailable.
 * No network, no model, no hosted service. Requires a local `gpg`.
 */

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_PATH_CHARS = 1024;

function usage() {
  return [
    "Usage:",
    "  node scripts/sign_release_artifact.mjs --artifact <file> --key <fingerprint> [--output <sig.asc>]",
    "  node scripts/sign_release_artifact.mjs --self-test",
    "",
    "Exit codes: 0 signed-and-verified, 1 verify-failed, 2 invalid input, 3 tool unavailable.",
  ].join("\n");
}

function fail(code, message) {
  process.stderr.write(`sign_release_artifact: ${message}\n${usage()}\n`);
  process.exit(code);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function validatePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH_CHARS) {
    fail(2, `${label} path is invalid.`);
  }
  if (value.includes("\0")) {
    fail(2, `${label} path is invalid.`);
  }
  return value;
}

function gpgAvailable() {
  try {
    execFileSync("gpg", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function runGpg(args, options = {}) {
  try {
    return { ok: true, stdout: execFileSync("gpg", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, ...options }) };
  } catch (error) {
    return { ok: false, status: typeof error.status === "number" ? error.status : -1, stderr: typeof error.stderr === "string" ? error.stderr.slice(0, 512) : "" };
  }
}

function sha256Of(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function selfTest() {
  if (!gpgAvailable()) {
    fail(3, "gpg is unavailable; signing procedure cannot run here.");
  }
  const home = mkdtempSync(join(tmpdir(), "skelet-sign-"));
  const env = { ...process.env, GNUPGHOME: home };
  try {
    const payloadPath = join(home, "payload.txt");
    writeFileSync(payloadPath, `skelet signing self-test ${randomBytes(8).toString("hex")}\n`);
    const gen = runGpg(["--batch", "--pinentry-mode", "loopback", "--passphrase", "skelet-self-test-only", "--quick-generate-key", "skelet-self-test <self-test@local>", "ed25519", "sign"], { env });
    if (!gen.ok) {
      fail(1, "ephemeral key generation failed.");
    }
    const sigPath = join(home, "payload.txt.asc");
    const sign = runGpg(["--batch", "--pinentry-mode", "loopback", "--passphrase", "skelet-self-test-only", "--detach-sign", "--armor", "--output", sigPath, payloadPath], { env });
    if (!sign.ok) {
      fail(1, "ephemeral signing failed.");
    }
    const verify = runGpg(["--batch", "--verify", sigPath, payloadPath], { env });
    if (!verify.ok) {
      fail(1, "ephemeral signature failed verification.");
    }
    process.stdout.write(`${JSON.stringify({ mode: "self-test", verified: true, payloadSha256: sha256Of(payloadPath) }, null, 2)}\n`);
    process.exit(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function operatorSign(artifactPath, key, outputPath) {
  if (!gpgAvailable()) {
    fail(3, "gpg is unavailable; signing procedure cannot run here.");
  }
  validatePath(artifactPath, "artifact");
  let stat;
  try {
    stat = readFileSync(artifactPath);
  } catch {
    fail(2, "artifact file is unavailable.");
  }
  if (stat.length === 0 || stat.length > MAX_ARTIFACT_BYTES) {
    fail(2, "artifact file exceeds its byte budget.");
  }
  if (typeof key !== "string" || !/^[0-9A-Fa-f]{16,40}$/.test(key)) {
    fail(2, "key fingerprint is invalid (16-40 hex characters).");
  }
  const sigPath = outputPath !== undefined ? validatePath(outputPath, "output") : `${artifactPath}.asc`;
  const sign = runGpg(["--batch", "--yes", "--detach-sign", "--armor", "--local-user", key, "--output", sigPath, artifactPath]);
  if (!sign.ok) {
    fail(1, `signing failed: ${sign.stderr}`);
  }
  const verify = runGpg(["--batch", "--verify", sigPath, artifactPath]);
  if (!verify.ok) {
    fail(1, `signature failed verification: ${verify.stderr}`);
  }
  process.stdout.write(`${JSON.stringify({ mode: "operator", artifactSha256: sha256Of(artifactPath), signature: sigPath, verified: true }, null, 2)}\n`);
  process.exit(0);
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  if (args.includes("--artifact") || args.includes("--key") || args.includes("--output")) {
    fail(2, "--self-test takes no other flags.");
  }
  selfTest();
} else if (args.includes("--artifact")) {
  operatorSign(argValue("--artifact"), argValue("--key"), argValue("--output"));
} else {
  fail(2, "either --self-test or --artifact with --key is required.");
}
