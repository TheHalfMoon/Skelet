import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { addMember, createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { createProduct, createProductVersion, createSource } from "../../../packages/db/src/repositories.ts";
import { createArtifact } from "../../../packages/db/src/graph.ts";
import { dispatchMcp } from "../lib/mcp.ts";
import {
  createBoardRoute,
  handOffBoardRoute,
  listBoardHandoffsRoute,
  saveBoardItemRoute,
  validateBoardItemsRoute,
} from "../lib/boards.ts";

let seq = 0;

async function fixture(tag) {
  seq += 1;
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: `mcpboard-${tag}-${seq}@skelet.example`, password: "board-member-01" });
  const fellow = await signUp(db, { email: `mcpboard-fellow-${tag}-${seq}@skelet.example`, password: "board-member-01" });
  const outsider = await signUp(db, { email: `mcpboard-out-${tag}-${seq}@skelet.example`, password: "board-member-01" });
  const space = await createWorkspace(db, { name: `MCP Board ${tag} ${seq}`, ownerId: owner.id });
  await addMember(db, { workspaceId: space.workspace.id, userId: fellow.id, role: "member", actorId: owner.id });
  return { db, owner, fellow, outsider, workspaceId: space.workspace.id, ctx: { userId: owner.id } };
}

async function screen(db, workspaceId, ownerId, index) {
  const source = await createSource(db, { key: `mcp-board-screen-${Date.now()}-${seq}-${index}`, kind: "synthetic" });
  const product = await createProduct(db, { sourceId: source.id, title: "Board app" });
  const version = await createProductVersion(db, { productId: product.id, versionNo: 1 });
  return createArtifact(db, {
    sourceId: source.id,
    productId: product.id,
    productVersionId: version.id,
    kind: "screen",
    title: `Board screen ${index}`,
    contentHash: `${index}`.repeat(64).slice(0, 64),
    rightsClassification: "metadata_only",
    visibility: "workspace",
    workspaceId,
    ownerSubject: ownerId,
  });
}

async function board(db, owner, workspaceId) {
  const result = await createBoardRoute(db, { workspaceId, title: "Moodboard", visibility: "workspace" }, owner.id);
  assert.equal(result.status, 201);
  return result.body.result.board;
}

async function mcpCall(db, ctx, name, args, id = 1) {
  return dispatchMcp(db, ctx, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
}

function mcpEnvelopeOf(response) {
  assert.ok(response.result?.content?.[0]?.text, "MCP success carries envelope text");
  return JSON.parse(response.result.content[0].text);
}

function mcpFailureOf(response) {
  assert.ok(response.error, "MCP failure carries JSON-RPC error");
  assert.ok(response.error.data?.envelope, "MCP failure carries envelope in data");
  return { code: response.error.code, envelope: response.error.data.envelope };
}

test("board handoff tools are advertised with stable identifiers", async () => {
  const fx = await fixture("advertise");
  try {
    const listed = await dispatchMcp(fx.db, fx.ctx, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const tools = Object.fromEntries(listed.result.tools.map((tool) => [tool.name, tool]));
    for (const name of ["board_handoff", "board_list_handoffs", "board_validate_items"]) {
      assert.ok(tools[name], `advertises ${name}`);
      assert.ok(tools[name].description.length > 0, `${name} has a description`);
    }
    assert.deepEqual(
      [...(tools.board_handoff.inputSchema.required ?? [])].sort(),
      ["toSubjectId", "workspaceId"],
    );
  } finally {
    await fx.db.close();
  }
});

test("MCP handoff assigns ledger proof and REST converges on the same board", async () => {
  const fx = await fixture("converge");
  try {
    const created = await board(fx.db, fx.owner, fx.workspaceId);
    const first = await screen(fx.db, fx.workspaceId, fx.owner.id, 1);
    const saved = await saveBoardItemRoute(
      fx.db, created.id, { workspaceId: fx.workspaceId, artifactId: first.id }, fx.owner.id,
    );
    assert.equal(saved.status, 200);
    const uri = `skelet://collection/${created.id}`;
    const handed = await mcpCall(fx.db, fx.ctx, "board_handoff", {
      uri,
      workspaceId: fx.workspaceId,
      toSubjectId: fx.fellow.id,
      requestId: "req-board-handoff-1",
    });
    const handedEnv = mcpEnvelopeOf(handed);
    assert.equal(handedEnv.schema_version, "skelet.agent.v1");
    assert.equal(handedEnv.request_id, "req-board-handoff-1");
    assert.equal(handedEnv.result.handoff.toSubject, fx.fellow.id);
    assert.equal(handedEnv.result.handoff.boardUri, uri);
    // REST sees the same ledger row and the same board identity.
    const restChain = await listBoardHandoffsRoute(fx.db, { boardId: created.id }, fx.fellow.id);
    assert.equal(restChain.status, 200);
    assert.equal(restChain.body.result.handoffs.length, 1);
    assert.equal(restChain.body.result.handoffs[0].id, handedEnv.result.handoff.id);
    const mcpChain = await mcpCall(fx.db, { userId: fx.fellow.id }, "board_list_handoffs", { boardId: created.id });
    const mcpChainEnv = mcpEnvelopeOf(mcpChain);
    assert.equal(mcpChainEnv.result.handoffs.length, 1);
    assert.equal(mcpChainEnv.result.handoffs[0].id, handedEnv.result.handoff.id);
    const mcpValidation = await mcpCall(fx.db, { userId: fx.fellow.id }, "board_validate_items", { uri });
    const validationEnv = mcpEnvelopeOf(mcpValidation);
    assert.equal(validationEnv.result.items.length, 1);
    assert.equal(validationEnv.result.items[0].status, "ok");
    assert.equal(validationEnv.result.summary.ok, 1);
    const restValidation = await validateBoardItemsRoute(fx.db, { boardId: created.id }, fx.fellow.id);
    assert.deepEqual(restValidation.body.result.summary, validationEnv.result.summary);
  } finally {
    await fx.db.close();
  }
});

test("MCP handoff denies outsiders without an existence oracle", async () => {
  const fx = await fixture("deny");
  try {
    const created = await board(fx.db, fx.owner, fx.workspaceId);
    const denied = await mcpCall(fx.db, { userId: fx.outsider.id }, "board_handoff", {
      boardId: created.id,
      workspaceId: fx.workspaceId,
      toSubjectId: fx.fellow.id,
    });
    const deniedFailure = mcpFailureOf(denied);
    const missing = await mcpCall(fx.db, { userId: fx.outsider.id }, "board_handoff", {
      boardId: "00000000-0000-4000-8000-000000000000",
      workspaceId: fx.workspaceId,
      toSubjectId: fx.fellow.id,
    });
    const missingFailure = mcpFailureOf(missing);
    assert.equal(deniedFailure.envelope.error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(missingFailure.envelope.error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(deniedFailure.envelope.error.message, missingFailure.envelope.error.message);
    const listDenied = await mcpCall(fx.db, { userId: fx.outsider.id }, "board_list_handoffs", { boardId: created.id });
    assert.equal(mcpFailureOf(listDenied).envelope.error.code, "FORBIDDEN_OR_NOT_FOUND");
    const validateDenied = await mcpCall(fx.db, { userId: fx.outsider.id }, "board_validate_items", { boardId: created.id });
    assert.equal(mcpFailureOf(validateDenied).envelope.error.code, "FORBIDDEN_OR_NOT_FOUND");
    // Malformed identifiers fail closed without leaking internals.
    const malformed = await mcpCall(fx.db, fx.ctx, "board_list_handoffs", { boardId: "not-a-uuid" });
    assert.equal(mcpFailureOf(malformed).envelope.error.code, "FORBIDDEN_OR_NOT_FOUND");
    const mismatched = await mcpCall(fx.db, fx.ctx, "board_list_handoffs", {
      boardId: created.id,
      uri: "skelet://collection/00000000-0000-4000-8000-000000000000",
    });
    assert.equal(mcpFailureOf(mismatched).envelope.error.code, "INVALID_INPUT");
    const missingId = await mcpCall(fx.db, fx.ctx, "board_list_handoffs", {});
    assert.equal(mcpFailureOf(missingId).envelope.error.code, "INVALID_INPUT");
    // The direct route layer agrees with MCP on the same denial.
    const restDenied = await handOffBoardRoute(
      fx.db, created.id, { workspaceId: fx.workspaceId, toSubjectId: fx.fellow.id }, fx.outsider.id,
    );
    assert.equal(restDenied.status, 404);
    assert.equal(restDenied.body.error.code, "FORBIDDEN_OR_NOT_FOUND");
  } finally {
    await fx.db.close();
  }
});
