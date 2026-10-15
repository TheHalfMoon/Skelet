import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createSource } from "../../../packages/db/src/repositories.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { importCorpusFixture } from "../../../packages/ingest/src/corpus.ts";
import { dispatchMcp } from "../lib/mcp.ts";
import {
  compareArtifactsRoute,
  findSimilarRoute,
  getAssetRoute,
  getChangesRoute,
  getFlowStepsRoute,
  getObjectRoute,
  listFlowsRoute,
  searchAssetsRoute,
} from "../lib/rest.ts";
import { AGENT_SCHEMA_VERSION } from "../lib/agent-contract.ts";

const SOURCE_VERSION = "golden-journey-1";
const ARTIFACT_URI_RE = /^skelet:\/\/artifact\/[A-Za-z0-9_-]{1,128}$/;

function assertStableEnvelope(envelope, context) {
  assert.equal(envelope.schema_version, AGENT_SCHEMA_VERSION, `${context}: schema_version`);
  assert.ok(
    typeof envelope.request_id === "string" && envelope.request_id.length >= 1 && envelope.request_id.length <= 128,
    `${context}: request_id 1..128`,
  );
  assert.ok(envelope.status === "complete" || envelope.status === "partial", `${context}: status`);
  assert.ok(typeof envelope.result === "object" && envelope.result !== null, `${context}: result object`);
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

function corpus(privateSpace) {
  return {
    products: [
      {
        externalId: "golden-shop",
        title: "Golden Shop",
        versions: [
          {
            versionNo: 1,
            artifacts: [
              {
                externalId: "cart-icon",
                kind: "icon",
                title: "Golden cart icon",
                summary: "Cart glyph",
                tags: ["golden-cart"],
                rightsClassification: "permitted",
              },
              {
                externalId: "checkout-screen",
                kind: "screen",
                title: "Golden checkout",
                summary: "Payment form v1",
                tags: ["golden-checkout"],
                rightsClassification: "permitted",
              },
            ],
            flows: [
              {
                externalId: "buy",
                title: "Golden buy flow",
                steps: [{ artifactExternalId: "checkout-screen", position: 0 }],
              },
            ],
          },
          {
            versionNo: 2,
            artifacts: [
              {
                externalId: "cart-icon",
                kind: "icon",
                title: "Golden cart icon",
                summary: "Cart glyph revised",
                tags: ["golden-cart"],
                rightsClassification: "permitted",
              },
              {
                externalId: "checkout-screen",
                kind: "screen",
                title: "Golden checkout",
                summary: "Payment form v1",
                tags: ["golden-checkout"],
                rightsClassification: "permitted",
              },
              {
                externalId: "receipt-screen",
                kind: "screen",
                title: "Golden receipt",
                summary: "Order confirmation",
                tags: ["golden-receipt"],
                rightsClassification: "permitted",
              },
              {
                externalId: "vault-screen",
                kind: "screen",
                title: "Golden vault screen",
                tags: ["golden-vault"],
                rightsClassification: "permitted",
                workspaceId: privateSpace,
              },
            ],
            flows: [
              {
                externalId: "buy",
                title: "Golden buy flow",
                steps: [
                  { artifactExternalId: "checkout-screen", position: 0 },
                  { artifactExternalId: "receipt-screen", position: 1 },
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
  const owner = await signUp(db, { email: "golden-owner@skelet.example", password: "golden-password-01" });
  const outsider = await signUp(db, { email: "golden-out@skelet.example", password: "golden-password-01" });
  const source = await createSource(db, { key: "golden-source", kind: "synthetic" });
  const space = await createWorkspace(db, { name: "Golden private", ownerId: owner.id });
  // Private artifacts require an owner binding alongside the workspace.
  const input = corpus(space.workspace.id);
  for (const product of input.products) {
    for (const version of product.versions) {
      for (const artifact of version.artifacts) {
        if (artifact.workspaceId !== undefined) artifact.ownerSubject = owner.id;
      }
    }
  }
  const summary = await importCorpusFixture(db, {
    sourceId: source.id,
    sourceVersion: SOURCE_VERSION,
    corpus: input,
  });
  assert.equal(summary.replayed, false);
  const versions = await db.query(
    `select pv.id, pv.version_no from product_versions pv
     join products p on p.id = pv.product_id
     where p.source_id = $1 order by pv.version_no`,
    [source.id],
  );
  const v1 = String(versions.rows.find((row) => Number(row.version_no) === 1).id);
  const v2 = String(versions.rows.find((row) => Number(row.version_no) === 2).id);
  return { db, owner, outsider, source, space, v1, v2 };
}

test("R3: golden journey from corpus import to cross-client pack recovery", async () => {
  const fx = await fixture();
  try {
    const ctx = { userId: fx.owner.id };

    // 1. Search the imported corpus over MCP, recover the same hit over REST.
    const searched = mcpEnvelopeOf(await mcpCall(fx.db, ctx, "search_assets", { query: "golden cart" }));
    assertStableEnvelope(searched, "journey search");
    assert.equal(searched.result.assets.length, 2);
    const iconUri = searched.result.assets[0].uri;
    assert.match(iconUri, ARTIFACT_URI_RE);
    const restSearch = await searchAssetsRoute(fx.db, { query: "golden cart" }, fx.owner.id);
    assert.equal(restSearch.status, 200);
    assert.deepEqual(
      restSearch.body.result.assets.map((entry) => entry.uri),
      searched.result.assets.map((entry) => entry.uri),
    );
    const iconId = iconUri.split("/").pop();

    // 2. Inspect the hit by stable URI on both transports.
    const got = mcpEnvelopeOf(await mcpCall(fx.db, ctx, "get_object", { uri: iconUri }));
    assertStableEnvelope(got, "journey get_object");
    assert.equal(got.result.object.title, "Golden cart icon");
    const restGot = await getObjectRoute(fx.db, iconUri, fx.owner.id);
    assert.equal(restGot.status, 200);
    assert.deepEqual(restGot.body.result, got.result);
    const asset = mcpEnvelopeOf(await mcpCall(fx.db, ctx, "get_asset", { artifactId: iconId }));
    assertStableEnvelope(asset, "journey get_asset");
    const restAsset = await getAssetRoute(fx.db, iconId, fx.owner.id);
    assert.equal(restAsset.status, 200);
    assert.deepEqual(restAsset.body.result, asset.result);

    // 3. Similar and compare over the corpus on both transports.
    const similar = mcpEnvelopeOf(await mcpCall(fx.db, ctx, "find_similar", { artifactId: iconId }));
    assertStableEnvelope(similar, "journey find_similar");
    assert.ok(similar.result.total >= 1);
    const restSimilar = await findSimilarRoute(fx.db, { artifactId: iconId }, fx.owner.id);
    assert.equal(restSimilar.status, 200);
    assert.deepEqual(restSimilar.body.result, similar.result);

    // 4. Flows and steps on both transports.
    const flows = mcpEnvelopeOf(await mcpCall(fx.db, ctx, "list_flows", {}));
    assertStableEnvelope(flows, "journey list_flows");
    assert.equal(flows.result.total, 2);
    const restFlows = await listFlowsRoute(fx.db, {}, fx.owner.id);
    assert.equal(restFlows.status, 200);
    assert.deepEqual(restFlows.body.result, flows.result);
    const flowId = flows.result.flows.find((flow) => flow.stepCount === 2).uri.split("/").pop();
    const steps = mcpEnvelopeOf(await mcpCall(fx.db, ctx, "get_flow_steps", { flowId }));
    assertStableEnvelope(steps, "journey get_flow_steps");
    assert.deepEqual(steps.result.steps.map((step) => step.position), [0, 1]);
    const restSteps = await getFlowStepsRoute(fx.db, flowId, fx.owner.id);
    assert.equal(restSteps.status, 200);
    assert.deepEqual(restSteps.body.result, steps.result);
    const screenId = steps.result.steps[0].uri.split("/").pop();

    // 5. Compare the v1/v2 icon across transports.
    const compared = mcpEnvelopeOf(
      await mcpCall(fx.db, ctx, "compare_design", { leftArtifactId: iconId, rightArtifactId: screenId }),
    );
    assertStableEnvelope(compared, "journey compare_design");
    assert.equal(compared.result.identical, false);
    const restCompared = await compareArtifactsRoute(
      fx.db,
      { left: iconId, right: screenId },
      fx.owner.id,
    );
    assert.equal(restCompared.status, 200);
    assert.deepEqual(restCompared.body.result, compared.result);

    // 6. Version diff: changed icon, added receipt, changed flow.
    const changes = mcpEnvelopeOf(
      await mcpCall(fx.db, ctx, "get_changes", { fromVersionId: fx.v1, toVersionId: fx.v2 }),
    );
    assertStableEnvelope(changes, "journey get_changes");
    assert.equal(changes.result.identical, false);
    assert.equal(changes.result.total, 4);
    const restChanges = await getChangesRoute(
      fx.db,
      { fromVersionId: fx.v1, toVersionId: fx.v2 },
      fx.owner.id,
    );
    assert.equal(restChanges.status, 200);
    assert.deepEqual(restChanges.body.result, changes.result);

    // 7. Save, pack, and recover every URI from a second transport (REST).
    const pack = mcpEnvelopeOf(
      await mcpCall(fx.db, ctx, "create_reference_pack", {
        workspaceId: fx.space.workspace.id,
        title: "Golden pack",
        artifactIds: [iconId, screenId],
      }),
    );
    assertStableEnvelope(pack, "journey create_reference_pack");
    assert.equal(pack.result.pack.itemCount, 2);
    for (const item of pack.result.pack.items) {
      const recovered = await getObjectRoute(fx.db, item.uri, fx.owner.id);
      assert.equal(recovered.status, 200, `REST recovers ${item.uri}`);
    }
    const saved = mcpEnvelopeOf(
      await mcpCall(fx.db, ctx, "save_reference", {
        collectionId: pack.result.pack.uri.split("/").pop(),
        artifactId: iconId,
      }),
    );
    assert.equal(saved.result.saved, true);

    // 8. Outsider isolation: private screen never leaks through any surface.
    const outsideChanges = await getChangesRoute(
      fx.db,
      { fromVersionId: fx.v1, toVersionId: fx.v2 },
      fx.outsider.id,
    );
    assert.equal(outsideChanges.status, 200);
    assert.equal(outsideChanges.body.result.total, 3);
    assert.ok(
      !JSON.stringify(outsideChanges.body).includes("Golden vault screen"),
      "private title never leaks via changes",
    );
    const denied = mcpFailureEnvelopeOf(
      await mcpCall(fx.db, { userId: fx.outsider.id }, "get_flow_steps", { flowId: "00000000-0000-7000-8000-000000000000" }),
    );
    assert.equal(denied.error.code, "FORBIDDEN_OR_NOT_FOUND");
  } finally {
    await fx.db.close();
  }
});


