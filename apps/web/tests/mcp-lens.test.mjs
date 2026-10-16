import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { advanceKitRun } from "../../../packages/db/src/build-kit.ts";
import { dispatchMcp } from "../lib/mcp.ts";
import {
  createLensJobRoute,
  downloadLensArtifactRoute,
  getLensJobRoute,
  lensUriFor,
  pollLensJobRoute,
} from "../lib/lens-jobs.ts";

const HEX64 = /^[0-9a-f]{64}$/;
let seq = 0;

function createArgs(workspaceId, overrides = {}) {
  seq += 1;
  return {
    workspaceId,
    sourceUrl: "https://example.org/",
    mode: "single-page",
    maxPages: 1,
    maxDepth: 0,
    maxBytes: 1048576,
    timeBudgetMs: 60000,
    idempotencyKey: `mcp-lens-${Date.now()}-${seq}`,
    ...overrides,
  };
}

async function fixture(tag) {
  seq += 1;
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: `mcplens-${tag}-${seq}@skilit.example`, password: "lens-member-01" });
  const outsider = await signUp(db, { email: `mcplens-out-${tag}-${seq}@skilit.example`, password: "lens-member-01" });
  const space = await createWorkspace(db, { name: `MCP Lens ${tag} ${seq}`, ownerId: owner.id });
  return { db, owner, outsider, workspaceId: space.workspace.id, ctx: { userId: owner.id } };
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

async function driveToCompleted(db, workspaceId, kitId, workerId = "worker-mcp-1") {
  let revision = 0;
  for (const next of ["capturing", "extracting", "generating", "validating"]) {
    const advanced = await advanceKitRun(db, {
      workspaceId,
      kitId,
      workerId,
      expectedRevision: revision,
      next,
    });
    revision = advanced.run.revision;
  }
  const done = await advanceKitRun(db, {
    workspaceId,
    kitId,
    workerId,
    expectedRevision: revision,
    next: "completed",
    options: {
      evidence: { analysis_id: "mcp", checks: ["schema"] },
      artifactManifest: { entries: [{ path: "manifest.json", sha256: "e".repeat(64), bytes: 64 }] },
    },
  });
  return done.run;
}

test("lens tools are advertised with stable identifiers", async () => {
  const fx = await fixture("advertise");
  try {
    const listed = await dispatchMcp(fx.db, fx.ctx, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const tools = Object.fromEntries(listed.result.tools.map((tool) => [tool.name, tool]));
    for (const name of [
      "lens_create_job",
      "lens_poll_job",
      "lens_get_job",
      "lens_cancel_job",
      "lens_retry_job",
      "lens_resume_job",
      "lens_read_artifact",
    ]) {
      assert.ok(tools[name], `advertises ${name}`);
      assert.ok(tools[name].description.length > 0, `${name} has a description`);
    }
    assert.deepEqual(
      [...(tools.lens_create_job.inputSchema.required ?? [])].sort(),
      ["idempotencyKey", "maxBytes", "maxDepth", "maxPages", "mode", "sourceUrl", "timeBudgetMs", "workspaceId"],
    );
  } finally {
    await fx.db.close();
  }
});

test("MCP create assigns durable identifiers and replays idempotently", async () => {
  const fx = await fixture("create");
  try {
    const args = createArgs(fx.workspaceId);
    const first = await mcpCall(fx.db, fx.ctx, "lens_create_job", { ...args, requestId: "req-mcp-create-1" });
    const firstEnv = mcpEnvelopeOf(first);
    assert.equal(firstEnv.schema_version, "skilit.agent.v1");
    assert.equal(firstEnv.request_id, "req-mcp-create-1");
    assert.equal(firstEnv.result.created, true);
    const job = firstEnv.result.job;
    assert.ok(HEX64.test(job.kitId));
    assert.equal(job.uri, lensUriFor(job.kitId));
    assert.equal(job.status, "queued");
    const replay = await mcpCall(fx.db, fx.ctx, "lens_create_job", args);
    const replayEnv = mcpEnvelopeOf(replay);
    assert.equal(replayEnv.result.created, false);
    assert.equal(replayEnv.result.job.kitId, job.kitId);
  } finally {
    await fx.db.close();
  }
});

test("REST and MCP converge on the same durable job", async () => {
  const fx = await fixture("converge");
  try {
    const args = createArgs(fx.workspaceId);
    const restBody = { ...args };
    const rest = await createLensJobRoute(fx.db, restBody, fx.owner.id, "req-converge-rest");
    assert.equal(rest.status, 201);
    const viaMcp = await mcpCall(fx.db, fx.ctx, "lens_create_job", { ...args });
    const viaMcpEnv = mcpEnvelopeOf(viaMcp);
    assert.equal(viaMcpEnv.result.created, false);
    assert.equal(viaMcpEnv.result.job.kitId, rest.body.result.job.kitId);
    assert.equal(viaMcpEnv.result.job.uri, rest.body.result.job.uri);
    const restPoll = await pollLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: rest.body.result.job.kitId },
      fx.owner.id,
    );
    const mcpPoll = await mcpCall(fx.db, fx.ctx, "lens_poll_job", {
      workspaceId: fx.workspaceId,
      uri: rest.body.result.job.uri,
    });
    const mcpPollEnv = mcpEnvelopeOf(mcpPoll);
    assert.deepEqual(mcpPollEnv.result.job, restPoll.body.result.job);
  } finally {
    await fx.db.close();
  }
});

test("MCP poll/get/cancel/retry mirror REST states and error codes", async () => {
  const fx = await fixture("mirror");
  try {
    const created = await mcpCall(fx.db, fx.ctx, "lens_create_job", createArgs(fx.workspaceId));
    const job = mcpEnvelopeOf(created).result.job;
    const byKit = mcpEnvelopeOf(
      await mcpCall(fx.db, fx.ctx, "lens_poll_job", { workspaceId: fx.workspaceId, kitId: job.kitId }),
    ).result.job;
    const byUri = mcpEnvelopeOf(
      await mcpCall(fx.db, fx.ctx, "lens_poll_job", { workspaceId: fx.workspaceId, uri: job.uri }),
    ).result.job;
    assert.deepEqual(byKit, byUri);
    assert.equal(byKit.status, "queued");
    const detail = mcpEnvelopeOf(
      await mcpCall(fx.db, fx.ctx, "lens_get_job", { workspaceId: fx.workspaceId, kitId: job.kitId }),
    ).result.job;
    assert.equal(detail.sourceUrl, "https://example.org/");
    assert.ok(detail.scope && detail.artifactSummary && Array.isArray(detail.attemptHistory));
    const canceled = mcpEnvelopeOf(
      await mcpCall(fx.db, fx.ctx, "lens_cancel_job", { workspaceId: fx.workspaceId, kitId: job.kitId }),
    ).result;
    assert.equal(canceled.applied, true);
    assert.equal(canceled.job.status, "canceled");
    const retryCanceled = mcpFailureOf(
      await mcpCall(fx.db, fx.ctx, "lens_retry_job", { workspaceId: fx.workspaceId, kitId: job.kitId }),
    );
    assert.equal(retryCanceled.envelope.error.code, "NOT_AVAILABLE");
    const restRetry = await getLensJobRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(restRetry.status, 200);
    assert.equal(restRetry.body.result.job.status, "canceled");
  } finally {
    await fx.db.close();
  }
});

test("MCP read_artifact matches REST download bytes and digest", async () => {
  const fx = await fixture("artifact");
  try {
    const created = await mcpCall(fx.db, fx.ctx, "lens_create_job", createArgs(fx.workspaceId));
    const job = mcpEnvelopeOf(created).result.job;
    await driveToCompleted(fx.db, fx.workspaceId, job.kitId);
    const read = mcpEnvelopeOf(
      await mcpCall(fx.db, fx.ctx, "lens_read_artifact", { workspaceId: fx.workspaceId, kitId: job.kitId }),
    ).result;
    const rest = await downloadLensArtifactRoute(
      fx.db,
      { workspaceId: fx.workspaceId, kitId: job.kitId },
      fx.owner.id,
    );
    assert.equal(rest.status, 200);
    assert.ok(rest.file);
    assert.equal(read.sha256, rest.file.sha256);
    assert.equal(read.sha256, createHash("sha256").update(rest.file.bytes).digest("hex"));
    assert.equal(read.mediaType, "application/json");
    assert.deepEqual(read.artifact, JSON.parse(new TextDecoder().decode(rest.file.bytes)));
    const evidence = mcpEnvelopeOf(
      await mcpCall(
        fx.db,
        fx.ctx,
        "lens_read_artifact",
        { workspaceId: fx.workspaceId, uri: job.uri, name: "evidence.json" },
      ),
    ).result;
    assert.ok(evidence.artifact && typeof evidence.sha256 === "string");
  } finally {
    await fx.db.close();
  }
});

test("MCP lens failures stay code-identical with REST", async () => {
  const fx = await fixture("failures");
  try {
    const unknownKit = "f".repeat(64);
    const cases = [
      {
        mcp: () => mcpCall(fx.db, fx.ctx, "lens_create_job", createArgs(fx.workspaceId, { sourceUrl: "http://example.org/" })),
        code: "INVALID_INPUT",
      },
      {
        mcp: () => mcpCall(fx.db, fx.ctx, "lens_poll_job", { workspaceId: fx.workspaceId, kitId: "short" }),
        code: "FORBIDDEN_OR_NOT_FOUND",
      },
      {
        mcp: () => mcpCall(fx.db, fx.ctx, "lens_get_job", { workspaceId: fx.workspaceId, uri: "skilit://lens/short" }),
        code: "FORBIDDEN_OR_NOT_FOUND",
      },
      {
        mcp: () => mcpCall(
          fx.db,
          fx.ctx,
          "lens_poll_job",
          { workspaceId: fx.workspaceId, kitId: "a".repeat(64), uri: lensUriFor("b".repeat(64)) },
        ),
        code: "INVALID_INPUT",
      },
      {
        mcp: () => mcpCall(fx.db, fx.ctx, "lens_poll_job", { workspaceId: fx.workspaceId, kitId: "short" }),
        code: "FORBIDDEN_OR_NOT_FOUND",
      },
      {
        mcp: () => mcpCall(fx.db, fx.ctx, "lens_poll_job", { workspaceId: fx.workspaceId, kitId: unknownKit }),
        code: "FORBIDDEN_OR_NOT_FOUND",
      },
      {
        mcp: () => mcpCall(
          fx.db,
          fx.ctx,
          "lens_resume_job",
          { workspaceId: fx.workspaceId, kitId: unknownKit, workerId: "  " },
        ),
        code: "INVALID_INPUT",
      },
      {
        mcp: () => mcpCall(
          fx.db,
          fx.ctx,
          "lens_read_artifact",
          { workspaceId: fx.workspaceId, kitId: unknownKit, name: "kit.zip" },
        ),
        code: "INVALID_INPUT",
      },
    ];
    for (const [index, entry] of cases.entries()) {
      const failure = mcpFailureOf(await entry.mcp());
      assert.equal(failure.envelope.error.code, entry.code, `case ${index}`);
      assert.equal(failure.envelope.schema_version, "skilit.agent.v1", `case ${index}`);
    }
    const created = await mcpCall(fx.db, fx.ctx, "lens_create_job", createArgs(fx.workspaceId));
    const job = mcpEnvelopeOf(created).result.job;
    const activeRead = mcpFailureOf(
      await mcpCall(fx.db, fx.ctx, "lens_read_artifact", { workspaceId: fx.workspaceId, kitId: job.kitId }),
    );
    assert.equal(activeRead.envelope.error.code, "NOT_AVAILABLE");
    const anon = mcpFailureOf(
      await mcpCall(fx.db, { userId: null }, "lens_poll_job", { workspaceId: fx.workspaceId, kitId: job.kitId }),
    );
    assert.equal(anon.code, -32001);
    assert.equal(anon.envelope.error.code, "UNAUTHENTICATED");
    const outsiderCtx = { userId: fx.outsider.id };
    for (const tool of ["lens_poll_job", "lens_get_job", "lens_cancel_job", "lens_retry_job", "lens_read_artifact"]) {
      const denied = mcpFailureOf(
        await mcpCall(fx.db, outsiderCtx, tool, { workspaceId: fx.workspaceId, kitId: job.kitId }),
      );
      assert.equal(denied.envelope.error.code, "FORBIDDEN_OR_NOT_FOUND", tool);
    }
  } finally {
    await fx.db.close();
  }
});

test("MCP quota exhaustion matches REST QUOTA_EXCEEDED", async () => {
  const fx = await fixture("quota");
  try {
    await mcpCall(fx.db, fx.ctx, "lens_create_job", createArgs(fx.workspaceId));
    await mcpCall(fx.db, fx.ctx, "lens_create_job", createArgs(fx.workspaceId));
    const third = mcpFailureOf(await mcpCall(fx.db, fx.ctx, "lens_create_job", createArgs(fx.workspaceId)));
    assert.equal(third.envelope.error.code, "QUOTA_EXCEEDED");
  } finally {
    await fx.db.close();
  }
});

test("MCP lens layer introduces no model provider dependency", async () => {
  for (const path of ["../lib/mcp.ts", "../lib/lens-jobs.ts"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const lensSection = path.endsWith("mcp.ts") ? source.slice(source.indexOf("lens_create_job")) : source;
    assert.ok(lensSection.includes("lens"), `${path} carries the lens surface`);
    for (const forbidden of ["packages/providers", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
      assert.ok(!source.includes(forbidden), `${path} must not reference ${forbidden}`);
    }
  }
});
