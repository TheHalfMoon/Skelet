import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createSource } from "../../../packages/db/src/repositories.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { importCorpusFixture } from "../../../packages/ingest/src/corpus.ts";
import { dispatchMcp } from "../lib/mcp.ts";
import { getFlowStepsRoute, listFlowsRoute } from "../lib/rest.ts";
import { AGENT_SCHEMA_VERSION } from "../lib/agent-contract.ts";

const SOURCE_VERSION = "flows-transport-1";
const FLOW_URI_RE = /^skilit:\/\/flow\/[A-Za-z0-9_-]{1,128}$/;

function assertStableEnvelope(envelope, context) {
  assert.equal(envelope.schema_version, AGENT_SCHEMA_VERSION, `${context}: schema_version`);
  assert.ok(
    typeof envelope.request_id === "string" && envelope.request_id.length >= 1 && envelope.request_id.length <= 128,
    `${context}: request_id 1..128`,
  );
  assert.equal(envelope.status, "complete", `${context}: status complete`);
  assert.ok(typeof envelope.result === "object" && envelope.result !== null, `${context}: result object`);
  if (envelope.provenance !== undefined) {
    assert.equal(envelope.provenance.evidence_mode, "observed", `${context}: evidence_mode`);
  }
  const text = JSON.stringify(envelope);
  for (const leaked of ["Error:", "\n    at ", "/Users/", "/work/", "password", "secret", "BEGIN PRIVATE", "database error", "PGError", "stack"]) {
    assert.ok(!text.includes(leaked), `${context}: must not leak ${JSON.stringify(leaked)}`);
  }
}

async function mcpCall(db, ctx, name, args) {
  return dispatchMcp(db, ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
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

function corpus() {
  return {
    products: [
      {
        externalId: "flow-shop",
        title: "Flow Shop",
        versions: [
          {
            versionNo: 1,
            artifacts: [
              {
                externalId: "landing",
                kind: "screen",
                title: "Flow landing",
                tags: ["landing"],
                rightsClassification: "permitted",
              },
              {
                externalId: "paywall",
                kind: "screen",
                title: "Flow paywall",
                tags: ["paywall"],
                rightsClassification: "permitted",
              },
            ],
            flows: [
              {
                externalId: "subscribe",
                title: "Subscribe flow",
                steps: [
                  { artifactExternalId: "landing", position: 0 },
                  {
                    artifactExternalId: "paywall",
                    position: 1,
                    interaction: { action: "tap", target: "subscribe" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "flows-t-owner@skilit.example", password: "flows-password-01" });
  const outsider = await signUp(db, { email: "flows-t-out@skilit.example", password: "flows-password-01" });
  const source = await createSource(db, { key: "flows-t-source", kind: "synthetic" });
  await importCorpusFixture(db, { sourceId: source.id, sourceVersion: SOURCE_VERSION, corpus: corpus() });
  const space = await createWorkspace(db, { name: "Flows transport", ownerId: owner.id });
  const secret = {
    products: [
      {
        externalId: "flow-vault",
        title: "Flow Vault",
        versions: [
          {
            versionNo: 1,
            artifacts: [
              {
                externalId: "vault-screen",
                kind: "screen",
                title: "Vault screen",
                tags: ["vault"],
                rightsClassification: "permitted",
                workspaceId: space.workspace.id,
                ownerSubject: owner.id,
              },
            ],
            flows: [
              {
                externalId: "vault-tour",
                title: "Vault tour",
                steps: [{ artifactExternalId: "vault-screen", position: 0 }],
              },
            ],
          },
        ],
      },
    ],
  };
  await importCorpusFixture(db, { sourceId: source.id, sourceVersion: SOURCE_VERSION, corpus: secret });
  return { db, owner, outsider, source };
}

test("AF-14a: MCP and REST serve identical flow listings and steps", async () => {
  const fx = await fixture();
  try {
    const mcp = await mcpCall(fx.db, { userId: fx.owner.id }, "list_flows", {
      requestId: "req-flows-parity-01",
    });
    const mcpEnvelope = mcpEnvelopeOf(mcp);
    assertStableEnvelope(mcpEnvelope, "MCP list_flows");
    assert.equal(mcpEnvelope.request_id, "req-flows-parity-01");
    assert.equal(mcpEnvelope.result.total, 2);
    for (const flow of mcpEnvelope.result.flows) {
      assert.ok(FLOW_URI_RE.test(flow.uri));
      assert.equal(typeof flow.stepCount, "number");
    }

    const rest = await listFlowsRoute(fx.db, {}, fx.owner.id, "req-flows-parity-02");
    assert.equal(rest.status, 200);
    assertStableEnvelope(rest.body, "REST list_flows");
    assert.deepEqual(rest.body.result, mcpEnvelope.result);

    const flowId = mcpEnvelope.result.flows.find((flow) => flow.title === "Subscribe flow").uri.split("/").pop();
    const mcpSteps = mcpEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "get_flow_steps", { flowId }),
    );
    assertStableEnvelope(mcpSteps, "MCP get_flow_steps");
    assert.equal(mcpSteps.result.steps.length, 2);
    assert.deepEqual(mcpSteps.result.steps.map((step) => step.position), [0, 1]);
    assert.deepEqual(mcpSteps.result.steps[1].interaction, { action: "tap", target: "subscribe" });

    const restSteps = await getFlowStepsRoute(fx.db, flowId, fx.owner.id);
    assert.equal(restSteps.status, 200);
    assert.deepEqual(restSteps.body.result, mcpSteps.result);
  } finally {
    await fx.db.close();
  }
});

test("AF-14a: flow queries validate, paginate, and deny without oracle", async () => {
  const fx = await fixture();
  try {
    const page = await listFlowsRoute(fx.db, { limit: "1" }, fx.owner.id);
    assert.equal(page.status, 200);
    assert.equal(page.body.result.flows.length, 1);
    assert.ok(typeof page.body.cursor === "string");
    const next = await listFlowsRoute(
      fx.db,
      { limit: "1", cursor: page.body.cursor },
      fx.owner.id,
    );
    assert.equal(next.body.result.flows.length, 1);
    assert.notEqual(next.body.result.flows[0].uri, page.body.result.flows[0].uri);

    for (const bad of [{ limit: "0" }, { cursor: "!!!bad!!!" }, { productVersionId: "nope" }]) {
      const restBad = await listFlowsRoute(fx.db, bad, fx.owner.id);
      assert.equal(restBad.status, 400, `REST rejects ${JSON.stringify(bad)}`);
      const mcpBad = await mcpCall(fx.db, { userId: fx.owner.id }, "list_flows", bad);
      assert.equal(mcpFailureEnvelopeOf(mcpBad).error.code, "INVALID_INPUT", `MCP rejects ${JSON.stringify(bad)}`);
    }
    const ghost = "00000000-0000-7000-8000-000000000000";
    const mcpGhost = mcpFailureEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.owner.id }, "get_flow_steps", { flowId: ghost }),
    );
    const listed = mcpEnvelopeOf(await mcpCall(fx.db, { userId: fx.owner.id }, "list_flows", {}));
    const hiddenUri = listed.result.flows.find((flow) => flow.title === "Vault tour").uri;
    const hiddenId = hiddenUri.split("/").pop();
    const mcpDenied = mcpFailureEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.outsider.id }, "get_flow_steps", { flowId: hiddenId }),
    );
    assert.equal(mcpGhost.error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(mcpDenied.error.code, "FORBIDDEN_OR_NOT_FOUND");
    assert.equal(mcpGhost.error.message, mcpDenied.error.message);

    const restGhost = await getFlowStepsRoute(fx.db, ghost, fx.owner.id);
    const restDenied = await getFlowStepsRoute(fx.db, hiddenId, fx.outsider.id);
    assert.equal(restGhost.status, 404);
    assert.equal(restDenied.status, 404);
    assert.equal(restGhost.body.error.message, restDenied.body.error.message);

    // Private flows never appear in outsider listings.
    const outside = await listFlowsRoute(fx.db, {}, fx.outsider.id);
    assert.equal(outside.body.result.total, 1);
    assert.ok(!outside.body.result.flows.some((flow) => flow.title === "Vault tour"));

    // Missing flow identifiers stay invalid input on both transports.
    const restMissing = await getFlowStepsRoute(fx.db, "nope", fx.owner.id);
    assert.equal(restMissing.status, 404);
    const mcpMissing = await mcpCall(fx.db, { userId: fx.owner.id }, "get_flow_steps", {});
    assert.equal(mcpFailureEnvelopeOf(mcpMissing).error.code, "INVALID_INPUT");
  } finally {
    await fx.db.close();
  }
});
