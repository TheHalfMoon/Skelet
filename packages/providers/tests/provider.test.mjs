import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderError,
  checkHealth,
  createRegistry,
  invokeProvider,
} from "../src/provider.ts";

function goodProvider() {
  return {
    id: "fixture-good",
    capability: "design-tokens",
    version: "commit:abc123",
    egress: "local",
    config: { palette: 8 },
    invoke: async (input, ctx) => {
      assert.equal(ctx.signal.aborted, false);
      return { tokens: [`color:${input}`] };
    },
    checkOutput: (output) => typeof output === "object" && output !== null,
    health: async () => ({ ok: true, detail: "ready" }),
    provenance: (input) => ({ source: input }),
  };
}

test("healthy provider round-trips with provenance", async () => {
  const result = await invokeProvider(goodProvider(), "page-1", { timeoutMs: 1000 });
  assert.deepEqual(result.output, { tokens: ["color:page-1"] });
  assert.equal(result.provenance.providerId, "fixture-good");
  assert.equal(result.provenance.capability, "design-tokens");
  assert.equal(result.provenance.version, "commit:abc123");
  assert.equal(result.provenance.egress, "local");
  assert.equal(result.provenance.costClass, "free-local");
  assert.deepEqual(result.provenance.detail, { source: "page-1" });
  assert.ok(result.durationMs >= 0);
});

test("slow providers fail closed with timeout", async () => {
  const slow = {
    ...goodProvider(),
    id: "fixture-slow",
    invoke: async (input, ctx) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5000);
        ctx.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
      return { tokens: [] };
    },
  };
  const started = Date.now();
  await assert.rejects(
    () => invokeProvider(slow, "page-1", { timeoutMs: 50 }),
    (error) => error instanceof ProviderError && error.code === "provider/timeout",
  );
  assert.ok(Date.now() - started < 2000, "timeout must bound execution");
});

test("timeouts are enforced on signal-ignoring providers", async () => {
  const stubborn = {
    ...goodProvider(),
    id: "fixture-stubborn",
    invoke: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return { tokens: [] };
    },
  };
  const started = Date.now();
  await assert.rejects(
    () => invokeProvider(stubborn, "page-1", { timeoutMs: 50 }),
    (error) => error instanceof ProviderError && error.code === "provider/timeout",
  );
  assert.ok(Date.now() - started < 2000, "timeout must settle the caller");
});

test("input guards fail fast before execution", async () => {
  let executed = false;
  const guarded = {
    ...goodProvider(),
    id: "fixture-guarded",
    checkInput: (input) => typeof input === "string",
    invoke: async (input) => {
      executed = true;
      return { tokens: [input] };
    },
  };
  await assert.rejects(
    () => invokeProvider(guarded, 42, { timeoutMs: 1000 }),
    (error) => error instanceof ProviderError && error.code === "provider/failed",
  );
  assert.equal(executed, false);
});

test("malformed outputs and failures classify exactly", async () => {
  const malformed = {
    ...goodProvider(),
    id: "fixture-malformed",
    invoke: async () => "not-an-object",
  };
  await assert.rejects(
    () => invokeProvider(malformed, "page-1", { timeoutMs: 1000 }),
    (error) => error instanceof ProviderError && error.code === "provider/malformed-output",
  );
  const failing = {
    ...goodProvider(),
    id: "fixture-failing",
    invoke: async () => {
      throw new Error("downstream exploded");
    },
  };
  await assert.rejects(
    () => invokeProvider(failing, "page-1", { timeoutMs: 1000 }),
    (error) => error instanceof ProviderError && error.code === "provider/failed",
  );
  const typed = {
    ...goodProvider(),
    id: "fixture-typed",
    invoke: async () => {
      throw new ProviderError("provider/unavailable", "Gone.");
    },
  };
  await assert.rejects(
    () => invokeProvider(typed, "page-1", { timeoutMs: 1000 }),
    (error) => error instanceof ProviderError && error.code === "provider/unavailable",
  );
  await assert.rejects(
    () => invokeProvider(goodProvider(), "page-1", { timeoutMs: 0 }),
    (error) => error instanceof ProviderError && error.code === "provider/failed",
  );
});

test("caller cancellation maps to canceled", async () => {
  const controller = new AbortController();
  const pending = invokeProvider(goodProvider(), "page-1", {
    timeoutMs: 1000,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(
    pending,
    (error) => error instanceof ProviderError && error.code === "provider/canceled",
  );
  const already = new AbortController();
  already.abort();
  await assert.rejects(
    () => invokeProvider(goodProvider(), "page-1", { signal: already.signal }),
    (error) => error instanceof ProviderError && error.code === "provider/canceled",
  );
});

test("health probes never throw", async () => {
  const report = await checkHealth(goodProvider());
  assert.equal(report.ok, true);
  assert.equal(report.detail, "ready");
  const down = await checkHealth({ ...goodProvider(), health: async () => ({ ok: false }) });
  assert.equal(down.ok, false);
  const exploding = await checkHealth({
    ...goodProvider(),
    health: async () => {
      throw new Error("probe crashed");
    },
  });
  assert.equal(exploding.ok, false);
  assert.match(exploding.detail ?? "", /probe crashed/);
});

test("registry binds identifiers and filters capabilities", async () => {
  const registry = createRegistry();
  registry.register(goodProvider());
  registry.register({ ...goodProvider(), id: "fixture-other", capability: "brand-clues" });
  assert.equal(registry.get("fixture-good").version, "commit:abc123");
  assert.deepEqual(registry.listByCapability("design-tokens"), ["fixture-good"]);
  assert.deepEqual(registry.listByCapability("brand-clues"), ["fixture-other"]);
  assert.deepEqual(registry.listByCapability("missing"), []);
  assert.throws(
    () => registry.register(goodProvider()),
    (error) => error instanceof ProviderError && error.code === "provider/failed",
  );
  assert.throws(
    () => registry.get("fixture-missing"),
    (error) => error instanceof ProviderError && error.code === "provider/unavailable",
  );
  assert.throws(
    () => registry.register({ ...goodProvider(), id: "  " }),
    (error) => error instanceof ProviderError && error.code === "provider/failed",
  );
  assert.throws(
    () => registry.register({ ...goodProvider(), id: "fixture-nocap", capability: "" }),
    (error) => error instanceof ProviderError && error.code === "provider/failed",
  );
  const frozen = registry.get("fixture-good");
  assert.equal(Object.isFrozen(frozen), true);
  const loud = {
    ...goodProvider(),
    id: "fixture-loud",
    invoke: async () => {
      throw new Error("x".repeat(5000));
    },
  };
  await assert.rejects(
    () => invokeProvider(loud, "page-1", { timeoutMs: 1000 }),
    (error) =>
      error instanceof ProviderError &&
      error.code === "provider/failed" &&
      error.message.length <= 2000,
  );
});
