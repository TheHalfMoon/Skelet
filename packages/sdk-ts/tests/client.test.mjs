import assert from "node:assert/strict";
import test from "node:test";

import { SDK_CONTRACT_VERSION, SdkError, SkeletClient } from "../src/client.ts";

const ASSET = {
  uri: "skelet://artifact/1",
  kind: "icon",
  title: "Arrow",
  license: "MIT",
  rights: "permitted",
  serving: "download",
  servingReason: "ok",
  source: "s",
  contentHash: "a".repeat(64),
};

function stubFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options);
  };
  return { fetchImpl, calls };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("client validates constructor input", () => {
  assert.throws(() => new SkeletClient({ baseUrl: "", token: "t" }), SdkError);
  assert.throws(() => new SkeletClient({ baseUrl: "https://x", token: "" }), SdkError);
  assert.throws(
    () => new SkeletClient({ baseUrl: "https://x", token: "t", timeoutMs: -1 }),
    SdkError,
  );
  assert.throws(() => new SkeletClient({ baseUrl: "not-a-url", token: "t" }), SdkError);
  assert.throws(() => new SkeletClient({ baseUrl: "http://example.com", token: "t" }), SdkError);
  const local = new SkeletClient({ baseUrl: "http://127.0.0.1:3103", token: "t" });
  assert.ok(local instanceof SkeletClient);
  const client = new SkeletClient({ baseUrl: "https://x///", token: "t" });
  assert.ok(client instanceof SkeletClient);
  assert.equal(SDK_CONTRACT_VERSION, "v1");
});

test("search shapes requests and parses assets", async () => {
  const { fetchImpl, calls } = stubFetch(async (url) => {
    assert.ok(url.startsWith("https://skelet.test/api/v1/assets?"));
    assert.ok(url.includes("query=arrow"));
    return jsonResponse(200, { assets: [ASSET] });
  });
  const client = new SkeletClient({
    baseUrl: "https://skelet.test",
    token: "secret",
    fetchImpl,
  });
  const assets = await client.searchAssets({ query: "arrow", kinds: "icon", limit: 5 });
  assert.equal(assets.length, 1);
  assert.equal(assets[0]?.uri, "skelet://artifact/1");
  assert.equal(calls[0]?.options.headers.authorization, "Bearer secret");
  await assert.rejects(() => client.searchAssets({ query: "  " }), SdkError);
});

test("getAsset and getObject recover by ID and URI", async () => {
  const { fetchImpl } = stubFetch(async (url) => {
    if (url.includes("/api/v1/assets/abc")) return jsonResponse(200, { asset: ASSET });
    if (url.includes("/api/v1/objects")) {
      return jsonResponse(200, { object: { uri: "skelet://artifact/abc", kind: "icon", title: "A", rights: "permitted" } });
    }
    return jsonResponse(404, { error: "Object was not found." });
  });
  const client = new SkeletClient({ baseUrl: "https://skelet.test", token: "t", fetchImpl });
  assert.equal((await client.getAsset("abc")).uri, "skelet://artifact/1");
  const object = await client.getObject("skelet://artifact/abc");
  assert.equal(object.title, "A");
  await assert.rejects(() => client.getAsset(""), SdkError);
});

test("status codes map to typed errors", async () => {
  const cases = [
    [401, "sdk/unauthorized"],
    [403, "sdk/forbidden"],
    [404, "sdk/not-found"],
    [429, "sdk/rate-limited"],
    [400, "sdk/invalid"],
    [500, "sdk/transport"],
  ];
  for (const [status, code] of cases) {
    const { fetchImpl } = stubFetch(async () => jsonResponse(status, { error: "x" }));
    const client = new SkeletClient({ baseUrl: "https://x", token: "t", fetchImpl });
    await assert.rejects(() => client.searchAssets({ query: "q" }), (error) => {
      return error instanceof SdkError && error.code === code && error.status === status;
    });
  }
  const { fetchImpl: failing } = stubFetch(async () => {
    throw new Error("socket hangup");
  });
  await assert.rejects(
    () => new SkeletClient({ baseUrl: "https://x", token: "t", fetchImpl: failing }).searchAssets({ query: "q" }),
    (error) => error instanceof SdkError && error.code === "sdk/transport",
  );
  const { fetchImpl: malformed } = stubFetch(async () => jsonResponse(200, { nope: true }));
  await assert.rejects(
    () => new SkeletClient({ baseUrl: "https://x", token: "t", fetchImpl: malformed }).searchAssets({ query: "q" }),
    (error) => error instanceof SdkError && error.code === "sdk/transport",
  );
});

test("redirects never forward credentials and shapes stay strict", async () => {
  const { fetchImpl, calls } = stubFetch(async (_url, options) => {
    assert.equal(options.redirect, "error");
    const error = new Error("redirect blocked");
    throw Object.assign(error, { name: "TypeError" });
  });
  const client = new SkeletClient({ baseUrl: "https://x", token: "t", fetchImpl });
  await assert.rejects(() => client.searchAssets({ query: "q" }), (error) => {
    return error instanceof SdkError && error.code === "sdk/transport";
  });
  assert.equal(calls.length, 1);
  const { fetchImpl: nullAsset } = stubFetch(async () => jsonResponse(200, { asset: null }));
  await assert.rejects(
    () => new SkeletClient({ baseUrl: "https://x", token: "t", fetchImpl: nullAsset }).getAsset("a"),
    (error) => error instanceof SdkError && error.code === "sdk/transport",
  );
  const { fetchImpl: ambiguous } = stubFetch(async () =>
    jsonResponse(200, { object: { uri: "x" }, pack: { uri: "y" } }),
  );
  await assert.rejects(
    () => new SkeletClient({ baseUrl: "https://x", token: "t", fetchImpl: ambiguous }).getObject("skelet://artifact/a"),
    (error) => error instanceof SdkError && error.code === "sdk/transport",
  );
});
test("requests time out fail-closed", async () => {
  const { fetchImpl } = stubFetch(async (_url, options) => {
    await new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
    return jsonResponse(200, { assets: [] });
  });
  const client = new SkeletClient({ baseUrl: "https://x", token: "t", fetchImpl, timeoutMs: 50 });
  await assert.rejects(() => client.searchAssets({ query: "q" }), (error) => {
    return error instanceof SdkError && error.code === "sdk/transport";
  });
});
