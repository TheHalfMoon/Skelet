import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../scripts/sign_release_artifact.mjs", import.meta.url));

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { exit: 0, stdout };
  } catch (error) {
    return {
      exit: typeof error.status === "number" ? error.status : -1,
      stdout: typeof error.stdout === "string" ? error.stdout : "",
    };
  }
}

function gpgPresent() {
  try {
    execSync("gpg --version", { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

test("P15-3: self-test proves the procedure or honestly reports a missing tool", () => {
  const result = run(["--self-test"]);
  if (!gpgPresent()) {
    assert.equal(result.exit, 3);
    return;
  }
  assert.equal(result.exit, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, "self-test");
  assert.equal(report.verified, true);
  assert.match(report.payloadSha256, /^[0-9a-f]{64}$/);
});

test("P15-3: invalid inputs fail closed with exit 2 and no report", () => {
  for (const args of [[], ["--self-test", "--artifact", "x"], ["--artifact", "x"], ["--artifact", "sbom.json", "--key", "not-hex"], ["--artifact", "/does/not/exist.json", "--key", "A084843B36903A5EB5564AFD2FD320CB766C0099"]]) {
    const result = run(args);
    assert.equal(result.exit, 2, JSON.stringify(args));
    assert.equal(result.stdout, "");
  }
});
