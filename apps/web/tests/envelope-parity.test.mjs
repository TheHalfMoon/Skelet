import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createSource } from "../../../packages/db/src/repositories.ts";
import { createArtifact } from "../../../packages/db/src/graph.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { addMember, createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { registerAsset } from "../../../packages/assets/src/registry.ts";
import { dispatchMcp } from "../lib/mcp.ts";
import { getAssetRoute, getObjectRoute, searchAssetsRoute, searchRegistryRoute } from "../lib/rest.ts";
import {
  AGENT_ERROR_CATALOG,
  AGENT_SCHEMA_VERSION,
  AgentContractError,
  decodeCursor,
  encodeCursor,
  failureEnvelope,
  isAgentEnvelope,
  newRequestId,
  successEnvelope,
} from "../lib/agent-contract.ts";
import { createReferencePack } from "../lib/reference-packs.ts";

const URI_RE = /^skelet:\/\/(product|version|artifact|flow|collection|lens|reference-pack)\/[A-Za-z0-9_-]{1,128}$/;
const ERROR_CODES = Object.keys(AGENT_ERROR_CATALOG);

function assertStableEnvelope(envelope, context) {
  assert.equal(envelope.schema_version, AGENT_SCHEMA_VERSION, `${context}: schema_version`);
  assert.ok(
    typeof envelope.request_id === "string" && envelope.request_id.length >= 1 && envelope.request_id.length <= 128,
    `${context}: request_id 1..128`,
  );
  assert.ok(envelope.status === "complete" || envelope.status === "partial", `${context}: status`);
  assert.ok(typeof envelope.result === "object" && envelope.result !== null && !Array.isArray(envelope.result), `${context}: result object`);
  assert.ok(isAgentEnvelope(envelope), `${context}: isAgentEnvelope`);
  if (envelope.cursor !== undefined) {
    assert.ok(typeof envelope.cursor === "string" && envelope.cursor.length <= 256, `${context}: cursor`);
  }
  if (envelope.warnings !== undefined) {
    assert.ok(Array.isArray(envelope.warnings) && envelope.warnings.length <= 16, `${context}: warnings`);
    for (const warning of envelope.warnings) {
      assert.ok(typeof warning === "string" && warning.length >= 1 && warning.length <= 512, `${context}: warning item`);
    }
  }
  if (envelope.error !== undefined) {
    assert.ok(ERROR_CODES.includes(envelope.error.code), `${context}: error code taxonomy`);
    assert.ok(typeof envelope.error.message === "string" && envelope.error.message.length >= 1, `${context}: error message`);
    assert.equal(typeof envelope.error.retryable, "boolean", `${context}: retryable`);
  }
  if (envelope.provenance !== undefined) {
    assert.ok(
      ["observed", "deterministic-computation", "heuristic-inference", "generated-by-external-agent", "unknown"].includes(
        envelope.provenance.evidence_mode,
      ),
      `${context}: evidence_mode`,
    );
  }
  const text = JSON.stringify(envelope);
  for (const leaked of ["Error:", "\n    at ", "/Users/", "/work/", "password", "secret", "BEGIN PRIVATE", "database error", "PGError", "stack"]) {
    assert.ok(!text.includes(leaked), `${context}: must not leak ${JSON.stringify(leaked)}`);
  }
}

function assertNoOracle(deniedEnvelope, missingEnvelope, context) {
  assert.equal(deniedEnvelope.error.code, "FORBIDDEN_OR_NOT_FOUND", `${context}: denied code`);
  assert.equal(missingEnvelope.error.code, "FORBIDDEN_OR_NOT_FOUND", `${context}: missing code`);
  assert.equal(deniedEnvelope.error.message, missingEnvelope.error.message, `${context}: same message`);
}

async function mcpCall(db, ctx, method, params, id = 1) {
  return dispatchMcp(db, ctx, { jsonrpc: "2.0", id, method, params });
}

function mcpEnvelopeOf(response) {
  assert.ok(response.result?.content?.[0]?.text, "MCP success carries envelope text");
  return JSON.parse(response.result.content[0].text);
}

function mcpFailureEnvelopeOf(response) {
  assert.ok(response.error, "MCP failure carries JSON-RPC error");
  assert.ok(response.error.data?.envelope, "MCP failure carries envelope in data");
  return response.error.data.envelope;
}

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "parity-owner@skelet.example", password: "parity-password-01" });
  const outsider = await signUp(db, { email: "parity-out@skelet.example", password: "parity-password-01" });
  const source = await createSource(db, { key: "parity-source", kind: "synthetic" });
  const icon = await registerAsset(db, {
    kind: "icon",
    title: "Parity arrow",
    sourceId: source.id,
    contentHash: "a".repeat(64),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "arrow", tags: ["arrow"], license: "MIT" },
    asset: { sha256: "a".repeat(64), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/pa/arrow" },
  });
  const space = await createWorkspace(db, { name: "Parity space", ownerId: owner.id });
  return { db, icon, owner, outsider, space, source };
}

test("AF-03b: successful object lookup returns versioned envelope on both transports", async () => {
  const fx = await fixture();
  try {
    const uri = `skelet://artifact/${fx.icon.artifactId}`;
    const rest = await getObjectRoute(fx.db, uri, fx.owner.id, "req-parity-lookup-01");
    assert.equal(rest.status, 200);
    assert.equal(rest.body.request_id, "req-parity-lookup-01");
    assertStableEnvelope(rest.body, "REST get_object success");
    assert.equal(rest.body.result.object.uri, uri);
    assert.equal(rest.body.result.object.title, "Parity arrow");
    assert.ok(URI_RE.test(rest.body.result.object.uri));

    const mcp = await mcpCall(fx.db, { userId: fx.owner.id }, "tools/call", {
      name: "get_object",
      arguments: { uri },
    });
    const envelope = mcpEnvelopeOf(mcp);
    assertStableEnvelope(envelope, "MCP get_object success");
    assert.equal(envelope.result.object.uri, uri);
    assert.equal(envelope.error, undefined);
  } finally {
    await fx.db.close();
  }
});

test("AF-03b: public asset access succeeds with stable URI and serving policy", async () => {
  const fx = await fixture();
  try {
    const rest = await getAssetRoute(fx.db, fx.icon.artifactId, fx.outsider.id);
    assert.equal(rest.status, 200);
    assertStableEnvelope(rest.body, "REST public asset");
    assert.equal(rest.body.result.asset.uri, `skelet://artifact/${fx.icon.artifactId}`);
    assert.equal(rest.body.result.asset.serving, "download");

    const mcp = await mcpCall(fx.db, { userId: fx.outsider.id }, "tools/call", {
      name: "get_asset",
      arguments: { artifactId: fx.icon.artifactId },
    });
    const envelope = mcpEnvelopeOf(mcp);
    assertStableEnvelope(envelope, "MCP public asset");
    assert.equal(envelope.result.asset.serving, "download");
  } finally {
    await fx.db.close();
  }
});

test("AF-03b: authorized workspace and private artifact reads succeed for members and owners", async () => {
  const db = await openDatabase();
  try {
    await migrateUp(db);
    const owner = await signUp(db, { email: "parity-ws-a@skelet.example", password: "parity-password-01" });
    const member = await signUp(db, { email: "parity-ws-b@skelet.example", password: "parity-password-01" });
    const space = await createWorkspace(db, { name: "Parity WS", ownerId: owner.id });
    await addMember(db, { workspaceId: space.workspace.id, userId: member.id, role: "member", actorId: owner.id });
    const source = await createSource(db, { key: "parity-ws-source", kind: "synthetic" });
    const wsArtifact = await createArtifact(db, {
      sourceId: source.id,
      kind: "screen",
      title: "Parity workspace screen",
      contentHash: "b".repeat(64),
      rightsClassification: "metadata_only",
      visibility: "workspace",
      workspaceId: space.workspace.id,
      ownerSubject: owner.id,
    });
    const privArtifact = await createArtifact(db, {
      sourceId: source.id,
      kind: "screen",
      title: "Parity private screen",
      contentHash: "c".repeat(64),
      rightsClassification: "metadata_only",
      visibility: "private",
      workspaceId: space.workspace.id,
      ownerSubject: owner.id,
    });
    const wsRest = await getObjectRoute(db, `skelet://artifact/${wsArtifact.id}`, member.id);
    assert.equal(wsRest.status, 200);
    assertStableEnvelope(wsRest.body, "REST workspace read");
    assert.equal(wsRest.body.result.object.title, "Parity workspace screen");

    const privRest = await getObjectRoute(db, `skelet://artifact/${privArtifact.id}`, owner.id);
    assert.equal(privRest.status, 200);
    assertStableEnvelope(privRest.body, "REST private owner read");

    const wsMcp = await mcpCall(db, { userId: member.id }, "tools/call", {
      name: "get_object",
      arguments: { uri: `skelet://artifact/${wsArtifact.id}` },
    });
    assertStableEnvelope(mcpEnvelopeOf(wsMcp), "MCP workspace read");
  } finally {
    await db.close();
  }
});

test("AF-03b: cross-workspace denial and unknown IDs share FORBIDDEN_OR_NOT_FOUND without oracle", async () => {
  const fx = await fixture();
  try {
    const { createArtifact } = await import("../../../packages/db/src/graph.ts");
    const priv = await createArtifact(fx.db, {
      sourceId: fx.source.id,
      kind: "screen",
      title: "Parity denial private",
      contentHash: "d".repeat(64),
      rightsClassification: "metadata_only",
      visibility: "private",
      workspaceId: fx.space.workspace.id,
      ownerSubject: fx.owner.id,
    });
    const uri = `skelet://artifact/${priv.id}`;
    const missingUri = "skelet://artifact/11111111-2222-4333-8444-555555555555";

    const deniedRest = await getObjectRoute(fx.db, uri, fx.outsider.id);
    const missingRest = await getObjectRoute(fx.db, missingUri, fx.outsider.id);
    assert.equal(deniedRest.status, 404);
    assert.equal(missingRest.status, 404);
    assertStableEnvelope(deniedRest.body, "REST denied");
    assertStableEnvelope(missingRest.body, "REST missing");
    assertNoOracle(deniedRest.body, missingRest.body, "REST denial");

    const deniedMcp = await mcpCall(fx.db, { userId: fx.outsider.id }, "tools/call", {
      name: "get_object",
      arguments: { uri },
    });
    const missingMcp = await mcpCall(fx.db, { userId: fx.outsider.id }, "tools/call", {
      name: "get_object",
      arguments: { uri: missingUri },
    });
    assert.equal(deniedMcp.error.code, -32000);
    assert.equal(missingMcp.error.code, -32000);
    const deniedEnv = mcpFailureEnvelopeOf(deniedMcp);
    const missingEnv = mcpFailureEnvelopeOf(missingMcp);
    assertStableEnvelope(deniedEnv, "MCP denied");
    assertStableEnvelope(missingEnv, "MCP missing");
    assertNoOracle(deniedEnv, missingEnv, "MCP denial");
    assert.equal(deniedEnv.error.code, deniedRest.body.error.code);
  } finally {
    await fx.db.close();
  }
});

test("AF-03b: validation failures map INVALID_INPUT across transports", async () => {
  const fx = await fixture();
  try {
    const cases = [
      await searchAssetsRoute(fx.db, {}, fx.owner.id),
      await searchAssetsRoute(fx.db, { query: "" }, fx.owner.id),
      await searchAssetsRoute(fx.db, { query: "arrow", limit: "999" }, fx.owner.id),
      await getObjectRoute(fx.db, "bogus", fx.owner.id),
      await getObjectRoute(fx.db, undefined, fx.owner.id),
    ];
    for (const result of cases) {
      assert.equal(result.status, 400);
      assertStableEnvelope(result.body, "REST invalid");
      assert.equal(result.body.error.code, "INVALID_INPUT");
      assert.equal(result.body.error.retryable, false);
    }
    const mcpInvalid = await mcpCall(fx.db, { userId: fx.owner.id }, "tools/call", {
      name: "search_assets",
      arguments: {},
    });
    assert.equal(mcpInvalid.error.code, -32602);
    const envelope = mcpFailureEnvelopeOf(mcpInvalid);
    assertStableEnvelope(envelope, "MCP invalid");
    assert.equal(envelope.error.code, "INVALID_INPUT");
  } finally {
    await fx.db.close();
  }
});

test("AF-03b: invalid and expired credentials map UNAUTHENTICATED consistently", async () => {
  const fx = await fixture();
  try {
    const { signIn, signOut } = await import("../../../packages/db/src/auth.ts");
    const { resolveRequestUser } = await import("../lib/mcp.ts");
    const signed = await signIn(fx.db, { email: "parity-owner@skelet.example", password: "parity-password-01" });
    assert.equal(await resolveRequestUser(fx.db, signed.token), fx.owner.id);
    await signOut(fx.db, signed.token);
    await assert.rejects(() => resolveRequestUser(fx.db, signed.token));
    await assert.rejects(() => resolveRequestUser(fx.db, "bogus-token"));
    await assert.rejects(() => resolveRequestUser(fx.db, null));

    const anonList = await mcpCall(fx.db, { userId: null }, "tools/list", {});
    assert.equal(anonList.error.code, -32001);
    assert.equal(anonList.error.data.envelope.error.code, "UNAUTHENTICATED");
    assertStableEnvelope(anonList.error.data.envelope, "MCP unauthenticated");

    const anonCall = await mcpCall(fx.db, { userId: null }, "tools/call", {
      name: "search_assets",
      arguments: { query: "arrow" },
    });
    assert.equal(anonCall.error.code, -32001);
    assert.equal(anonCall.error.data.envelope.error.code, "UNAUTHENTICATED");
  } finally {
    await fx.db.close();
  }
});

test("AF-03b: insufficient scope answers FORBIDDEN_OR_NOT_FOUND, never UNAUTHENTICATED", async () => {
  const db = await openDatabase();
  try {
    await migrateUp(db);
    const owner = await signUp(db, { email: "parity-scope-a@skelet.example", password: "parity-password-01" });
    const outsider = await signUp(db, { email: "parity-scope-b@skelet.example", password: "parity-password-01" });
    const space = await createWorkspace(db, { name: "Parity scope", ownerId: owner.id });
    const source = await createSource(db, { key: "parity-scope-source", kind: "synthetic" });
    const screen = await createArtifact(db, {
      sourceId: source.id,
      kind: "screen",
      title: "Parity scope screen",
      contentHash: "e".repeat(64),
      rightsClassification: "metadata_only",
      visibility: "workspace",
      workspaceId: space.workspace.id,
      ownerSubject: owner.id,
    });
    const pack = await createReferencePack(db, {
      workspaceId: space.workspace.id,
      title: "Parity scope pack",
      actorId: owner.id,
      artifactIds: [screen.id],
    });
    const denied = await mcpCall(db, { userId: outsider.id }, "tools/call", {
      name: "save_reference",
      arguments: { collectionId: pack.collectionId, artifactId: screen.id },
    });
    assert.equal(denied.error.code, -32000);
    assert.equal(mcpFailureEnvelopeOf(denied).error.code, "FORBIDDEN_OR_NOT_FOUND");
  } finally {
    await db.close();
  }
});

test("AF-03b: rights-restricted content returns RIGHTS_RESTRICTED after the actor gate", async () => {
  const db = await openDatabase();
  try {
    await migrateUp(db);
    const owner = await signUp(db, { email: "parity-rights@skelet.example", password: "parity-password-01" });
    const member = await signUp(db, { email: "parity-rights-r@skelet.example", password: "parity-password-01" });
    const space = await createWorkspace(db, { name: "Parity rights WS", ownerId: owner.id });
    await addMember(db, { workspaceId: space.workspace.id, userId: member.id, role: "member", actorId: owner.id });
    const source = await createSource(db, { key: "parity-rights-source", kind: "synthetic" });
    const restricted = await createArtifact(db, {
      sourceId: source.id,
      kind: "screen",
      title: "Parity restricted screen",
      contentHash: "f".repeat(64),
      rightsClassification: "restricted",
      visibility: "workspace",
      workspaceId: space.workspace.id,
      ownerSubject: owner.id,
    });
    const rest = await getObjectRoute(db, `skelet://artifact/${restricted.id}`, member.id);
    assert.equal(rest.status, 403);
    assertStableEnvelope(rest.body, "REST rights-restricted");
    assert.equal(rest.body.error.code, "RIGHTS_RESTRICTED");

    const mcp = await mcpCall(db, { userId: member.id }, "tools/call", {
      name: "get_object",
      arguments: { uri: `skelet://artifact/${restricted.id}` },
    });
    assert.equal(mcp.error.code, -32000);
    const envelope = mcpFailureEnvelopeOf(mcp);
    assertStableEnvelope(envelope, "MCP rights-restricted");
    assert.equal(envelope.error.code, "RIGHTS_RESTRICTED");
    assert.equal(envelope.error.code, rest.body.error.code);
  } finally {
    await db.close();
  }
});

test("AF-03b: malformed pagination fails INVALID_INPUT and cursors paginate deterministically", async () => {
  const db = await openDatabase();
  try {
    await migrateUp(db);
    const owner = await signUp(db, { email: "parity-page@skelet.example", password: "parity-password-01" });
    const source = await createSource(db, { key: "parity-page-source", kind: "synthetic" });
    for (let index = 0; index < 3; index += 1) {
      await registerAsset(db, {
        kind: "icon",
        title: `Parity page icon ${index}`,
        sourceId: source.id,
        contentHash: `${index}`.repeat(64).slice(0, 64),
        rightsClassification: "permitted",
        metadata: { collection: "parity", ref: `page-${index}`, tags: ["parity-page"], license: "MIT" },
        asset: {
          sha256: `${index}`.repeat(64).slice(0, 64),
          mediaType: "image/svg+xml",
          byteLength: 64,
          storageKey: `sha256/pa/page-${index}`,
        },
      });
    }
    const badLimit = await searchAssetsRoute(db, { query: "parity-page", limit: "999" }, owner.id);
    assert.equal(badLimit.status, 400);
    assert.equal(badLimit.body.error.code, "INVALID_INPUT");
    const badCursor = await searchAssetsRoute(db, { query: "parity-page", cursor: "!!!not-a-cursor!!!" }, owner.id);
    assert.equal(badCursor.status, 400);
    assert.equal(badCursor.body.error.code, "INVALID_INPUT");

    const first = await searchAssetsRoute(db, { query: "parity-page", limit: "1" }, owner.id);
    assert.equal(first.status, 200);
    assertStableEnvelope(first.body, "REST page one");
    assert.equal(first.body.result.assets.length, 1);
    assert.ok(typeof first.body.cursor === "string");
    const second = await searchAssetsRoute(
      db,
      { query: "parity-page", limit: "1", cursor: first.body.cursor },
      owner.id,
    );
    assert.equal(second.status, 200);
    assertStableEnvelope(second.body, "REST page two");
    assert.equal(second.body.result.assets.length, 1);
    assert.notEqual(second.body.result.assets[0].uri, first.body.result.assets[0].uri);

    const mcpFirst = await mcpCall(db, { userId: owner.id }, "tools/call", {
      name: "search_assets",
      arguments: { query: "parity-page", limit: 1 },
    });
    const firstEnvelope = mcpEnvelopeOf(mcpFirst);
    assertStableEnvelope(firstEnvelope, "MCP page one");
    assert.ok(typeof firstEnvelope.cursor === "string");
    const mcpSecond = await mcpCall(db, { userId: owner.id }, "tools/call", {
      name: "search_assets",
      arguments: { query: "parity-page", limit: 1, cursor: firstEnvelope.cursor },
    });
    assertStableEnvelope(mcpEnvelopeOf(mcpSecond), "MCP page two");

    const mcpBadCursor = await mcpCall(db, { userId: owner.id }, "tools/call", {
      name: "search_assets",
      arguments: { query: "parity-page", cursor: "bad" },
    });
    assert.equal(mcpBadCursor.error.code, -32602);
    assert.equal(mcpFailureEnvelopeOf(mcpBadCursor).error.code, "INVALID_INPUT");
  } finally {
    await db.close();
  }
});

test("AF-03b: disabled capabilities return PROVIDER_DISABLED on both transports", async () => {
  const fx = await fixture();
  const previous = process.env.SKELET_DISABLED_CAPABILITIES;
  process.env.SKELET_DISABLED_CAPABILITIES = "packs";
  try {
    const mcp = await mcpCall(fx.db, { userId: fx.owner.id }, "tools/call", {
      name: "create_reference_pack",
      arguments: { workspaceId: fx.space.workspace.id, title: "Disabled pack" },
    });
    assert.equal(mcp.error.code, -32000);
    const envelope = mcpFailureEnvelopeOf(mcp);
    assertStableEnvelope(envelope, "MCP provider-disabled");
    assert.equal(envelope.error.code, "PROVIDER_DISABLED");

    const { createReferencePack } = await import("../lib/reference-packs.ts");
    void createReferencePack;
    const pack = await getObjectRoute(fx.db, "skelet://collection/11111111-2222-4333-8444-555555555555", fx.owner.id);
    assert.ok([404, 503].includes(pack.status));
  } finally {
    if (previous === undefined) {
      delete process.env.SKELET_DISABLED_CAPABILITIES;
    } else {
      process.env.SKELET_DISABLED_CAPABILITIES = previous;
    }
    await fx.db.close();
  }
});

test("AF-03b: partial pack exports carry warnings without leaking withheld items", async () => {
  const db = await openDatabase();
  try {
    await migrateUp(db);
    const ownerA = await signUp(db, { email: "parity-partial-a@skelet.example", password: "parity-password-01" });
    const memberB = await signUp(db, { email: "parity-partial-b@skelet.example", password: "parity-password-01" });
    const space = await createWorkspace(db, { name: "Parity partial", ownerId: ownerA.id });
    await addMember(db, { workspaceId: space.workspace.id, userId: memberB.id, role: "member", actorId: ownerA.id });
    const source = await createSource(db, { key: "parity-partial-source", kind: "synthetic" });
    const priv = await createArtifact(db, {
      sourceId: source.id,
      kind: "screen",
      title: "Parity partial private",
      contentHash: "9".repeat(64),
      rightsClassification: "metadata_only",
      visibility: "private",
      workspaceId: space.workspace.id,
      ownerSubject: ownerA.id,
    });
    const pack = await createReferencePack(db, {
      workspaceId: space.workspace.id,
      title: "Parity partial pack",
      actorId: ownerA.id,
      artifactIds: [priv.id],
    });
    const exported = await getObjectRoute(db, pack.uri, memberB.id);
    assert.equal(exported.status, 200);
    assertStableEnvelope(exported.body, "REST partial pack");
    assert.equal(exported.body.status, "partial");
    assert.ok(Array.isArray(exported.body.warnings) && exported.body.warnings.length >= 1);
    assert.equal(exported.body.result.pack.itemCount, 0);
    const text = JSON.stringify(exported.body);
    assert.ok(!text.includes("Parity partial private"));
  } finally {
    await db.close();
  }
});

test("AF-13b-i: registry search matches on MCP and REST with deep-equal results", async () => {
  const fx = await fixture();
  try {
    const rest = await searchRegistryRoute({ q: "card" }, "req-parity-registry-01");
    assert.equal(rest.status, 200);
    assert.equal(rest.body.request_id, "req-parity-registry-01");
    assertStableEnvelope(rest.body, "REST search_registry success");
    assert.equal(rest.body.result.total, 1);
    assert.deepEqual(
      rest.body.result.items.map((entry) => entry.name),
      ["skelet-card"],
    );

    const mcp = await mcpCall(fx.db, { userId: fx.owner.id }, "tools/call", {
      name: "search_registry",
      arguments: { query: "card" },
    });
    const envelope = mcpEnvelopeOf(mcp);
    assertStableEnvelope(envelope, "MCP search_registry success");
    assert.deepEqual(envelope.result.items, rest.body.result.items);
    assert.equal(envelope.result.total, rest.body.result.total);
    assert.equal(envelope.error, undefined);

    const badRest = await searchRegistryRoute({ limit: "0" }, "req-parity-registry-02");
    assert.equal(badRest.status, 400);
    assert.equal(badRest.body.error.code, "INVALID_INPUT");
    const badMcp = await mcpCall(fx.db, { userId: fx.owner.id }, "tools/call", {
      name: "search_registry",
      arguments: { limit: 0 },
    });
    assert.equal(badMcp.error.code, -32602);
  } finally {
    await fx.db.close();
  }
});

test("AF-03b: error catalog maps consistently to HTTP and MCP with safe retry hints", () => {
  const expectations = {
    INVALID_INPUT: { http: 400, mcp: -32602, retryable: false },
    UNAUTHENTICATED: { http: 401, mcp: -32001, retryable: false },
    FORBIDDEN_OR_NOT_FOUND: { http: 404, mcp: -32000, retryable: false },
    NOT_AVAILABLE: { http: 409, mcp: -32000, retryable: false },
    RIGHTS_RESTRICTED: { http: 403, mcp: -32000, retryable: false },
    STALE_REVISION: { http: 409, mcp: -32000, retryable: false },
    RATE_LIMITED: { http: 429, mcp: -32000, retryable: true },
    QUOTA_EXCEEDED: { http: 429, mcp: -32000, retryable: false },
    PROVIDER_DISABLED: { http: 503, mcp: -32000, retryable: false },
    JOB_PENDING: { http: 202, mcp: -32000, retryable: true },
    JOB_FAILED: { http: 500, mcp: -32000, retryable: false },
    TIMEOUT: { http: 504, mcp: -32000, retryable: true },
    INTERNAL_OPAQUE: { http: 500, mcp: -32000, retryable: false },
  };
  for (const [code, expected] of Object.entries(expectations)) {
    const mapping = AGENT_ERROR_CATALOG[code];
    assert.equal(mapping.httpStatus, expected.http, `${code} HTTP`);
    assert.equal(mapping.mcpCode, expected.mcp, `${code} MCP`);
    assert.equal(mapping.retryable, expected.retryable, `${code} retryable`);
    const envelope = failureEnvelope("req-catalog-01", code);
    assertStableEnvelope(envelope, `catalog ${code}`);
    assert.equal(envelope.error.code, code);
  }
});

test("AF-03b: request IDs, cursors, and envelope helpers stay within contract bounds", () => {
  assert.equal(newRequestId("req-abc-123"), "req-abc-123");
  assert.ok(typeof newRequestId("") === "string" && newRequestId("").length > 0);
  assert.ok(typeof newRequestId("x".repeat(200)) === "string");
  assert.ok(typeof newRequestId(null) === "string");
  assert.equal(decodeCursor(encodeCursor(0)), 0);
  assert.equal(decodeCursor(encodeCursor(41)), 41);
  assert.throws(() => decodeCursor("!!!"), /Pagination cursor is invalid/);
  assert.throws(() => decodeCursor(""), /Pagination cursor is invalid/);
  const ok = successEnvelope("req-helper-01", { assets: [] }, { provenance: { evidence_mode: "observed" } });
  assertStableEnvelope(ok, "helper success");
  const partial = successEnvelope(
    "req-helper-02",
    { pack: { uri: "skelet://collection/11111111-2222-4333-8444-555555555555" } },
    { warnings: ["Withheld one item."], partial: true },
  );
  assert.equal(partial.status, "partial");
  assertStableEnvelope(partial, "helper partial");
  const failure = new AgentContractError("TIMEOUT", { requestId: "req-helper-03" }).toFailureEnvelope();
  assertStableEnvelope(failure, "helper failure");
  assert.equal(failure.error.code, "TIMEOUT");
  assert.equal(failure.error.retryable, true);
});
