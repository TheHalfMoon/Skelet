import assert from "node:assert/strict";
import test from "node:test";

import {
  FORBIDDEN_MODEL_ENV_VARS,
  NoModelError,
  UNAPPROVED_EGRESS_HOSTS,
  assertNoUnapprovedEgress,
  assertProviderAllowed,
  describeNoModelStatus,
  hostOfUrl,
  inspectNoModelEnv,
  isUnapprovedEgressHost,
  parseNoModelFlag,
  validateNoModelEnv,
} from "../src/no-model.ts";

test("parseNoModelFlag defaults to strict and accepts explicit states", () => {
  assert.equal(parseNoModelFlag(undefined), true);
  assert.equal(parseNoModelFlag("1"), true);
  assert.equal(parseNoModelFlag("0"), false);
  assert.throws(() => parseNoModelFlag("true"), NoModelError);
  assert.throws(() => parseNoModelFlag("yes"), NoModelError);
  assert.throws(() => parseNoModelFlag(""), NoModelError);
  assert.throws(() => parseNoModelFlag("2"), NoModelError);
});

test("forbidden credential list covers launch-critical providers", () => {
  for (const name of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "REPLICATE_API_TOKEN",
    "HF_TOKEN",
    "FIRECRAWL_API_KEY",
    "PINECONE_API_KEY",
  ]) {
    assert.ok(FORBIDDEN_MODEL_ENV_VARS.includes(name), `missing ${name}`);
  }
  assert.ok(UNAPPROVED_EGRESS_HOSTS.includes("api.openai.com"));
  assert.ok(UNAPPROVED_EGRESS_HOSTS.includes("api.anthropic.com"));
});

test("clean environment validates with zero forbidden names", () => {
  const report = validateNoModelEnv({});
  assert.equal(report.enabled, true);
  assert.deepEqual(report.forbiddenPresent, []);
});

test("strict mode fails closed when a model credential is present", () => {
  assert.throws(
    () => validateNoModelEnv({ OPENAI_API_KEY: "sk-test" }),
    (error) =>
      error instanceof NoModelError &&
      error.code === "no-model/credential-present" &&
      /OPENAI_API_KEY/.test(error.message) &&
      !/sk-test/.test(error.message),
  );
  assert.throws(
    () => validateNoModelEnv({ SKELET_NO_MODEL: "1", ANTHROPIC_API_KEY: "x" }),
    /ANTHROPIC_API_KEY/,
  );
});

test("empty credential values do not count as present", () => {
  const report = validateNoModelEnv({ OPENAI_API_KEY: "" });
  assert.deepEqual(report.forbiddenPresent, []);
});

test("explicit opt-out does not enforce credential absence", () => {
  const report = validateNoModelEnv({
    SKELET_NO_MODEL: "0",
    OPENAI_API_KEY: "sk-test",
  });
  assert.equal(report.enabled, false);
  assert.deepEqual(report.forbiddenPresent, []);
});

test("invalid SKELET_NO_MODEL fails closed", () => {
  assert.throws(() => validateNoModelEnv({ SKELET_NO_MODEL: "strict" }), NoModelError);
  assert.throws(() => inspectNoModelEnv({ SKELET_NO_MODEL: "strict" }), NoModelError);
});

test("unapproved egress hosts are denied including subdomains", () => {
  assert.equal(isUnapprovedEgressHost("api.openai.com"), true);
  assert.equal(isUnapprovedEgressHost("API.OPENAI.COM"), true);
  assert.equal(isUnapprovedEgressHost("sub.api.openai.com"), true);
  assert.equal(isUnapprovedEgressHost("api.openai.com."), true);
  assert.equal(isUnapprovedEgressHost("example.com"), false);
  assert.equal(isUnapprovedEgressHost("openai.com.evil.example"), false);
  assert.equal(isUnapprovedEgressHost(""), false);
});

test("assertNoUnapprovedEgress allows target sites and denies providers", () => {
  assertNoUnapprovedEgress("https://example.com/page");
  assertNoUnapprovedEgress("http://example.org/");
  assert.throws(() => assertNoUnapprovedEgress("https://api.openai.com/v1/chat"), NoModelError);
  assert.throws(
    () => assertNoUnapprovedEgress("https://sub.api.anthropic.com/x"),
    (error) => error instanceof NoModelError && error.code === "no-model/egress-denied",
  );
  assert.throws(() => assertNoUnapprovedEgress("file:///etc/passwd"), NoModelError);
  assert.throws(() => assertNoUnapprovedEgress("not-a-url"), NoModelError);
});

test("hostOfUrl extracts http(s) hosts only", () => {
  assert.equal(hostOfUrl("https://Example.COM/a"), "example.com");
  assert.equal(hostOfUrl("http://127.0.0.1/"), "127.0.0.1");
  assert.equal(hostOfUrl("file:///x"), null);
  assert.equal(hostOfUrl("javascript:alert(1)"), null);
  assert.equal(hostOfUrl(""), null);
});

test("provider guard allows local fallback and denies external in strict mode", () => {
  assertProviderAllowed({ egress: "none" }, true);
  assertProviderAllowed({ egress: "local" }, true);
  assertProviderAllowed({ egress: "none" }, false);
  assertProviderAllowed({ egress: "local" }, false);
  assertProviderAllowed({ egress: "external" }, false);
  assert.throws(
    () => assertProviderAllowed({ egress: "external" }, true),
    (error) => error instanceof NoModelError && error.code === "no-model/egress-denied",
  );
});

test("status descriptor is redacted and deterministic", () => {
  const clean = describeNoModelStatus({});
  assert.deepEqual(clean, { enabled: true, egress: "deny-unapproved", forbiddenCount: 0 });
  const dirty = describeNoModelStatus({ OPENAI_API_KEY: "sk-secret-value" });
  assert.equal(dirty.forbiddenCount, 1);
  assert.ok(!JSON.stringify(dirty).includes("sk-secret-value"));
  const opted = describeNoModelStatus({ SKELET_NO_MODEL: "0" });
  assert.equal(opted.enabled, false);
});
