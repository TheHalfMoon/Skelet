import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { createSource } from "../../../packages/db/src/repositories.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import { registerAsset } from "../../../packages/assets/src/registry.ts";
import { createReferencePack } from "../lib/reference-packs.ts";
import { getAssetRoute, getObjectRoute, searchAssetsRoute } from "../lib/rest.ts";

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "rest@skelet.example", password: "rest-password-01" });
  const outsider = await signUp(db, { email: "rest-out@skelet.example", password: "rest-password-01" });
  const source = await createSource(db, { key: "rest-source", kind: "synthetic" });
  const icon = await registerAsset(db, {
    kind: "icon",
    title: "REST arrow",
    sourceId: source.id,
    contentHash: "7".repeat(64),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "arrow", tags: ["arrow"], license: "MIT" },
    asset: { sha256: "7".repeat(64), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/re/arrow" },
  });
  const space = await createWorkspace(db, { name: "REST space", ownerId: owner.id });
  return { db, icon, owner, outsider, space };
}

test("search endpoint validates and returns URI-grounded assets", async () => {
  const fx = await fixture();
  try {
    const ok = await searchAssetsRoute(fx.db, { query: "arrow" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.assets.length, 1);
    assert.equal(ok.body.assets[0].uri, `skelet://artifact/${fx.icon.artifactId}`);
    assert.equal((await searchAssetsRoute(fx.db, {})).status, 400);
    assert.equal((await searchAssetsRoute(fx.db, { query: "arrow", limit: "500" })).status, 400);
    assert.equal((await searchAssetsRoute(fx.db, { query: "arrow", kinds: "spaceship" })).status, 400);
    assert.equal((await searchAssetsRoute(fx.db, { query: "missing" })).body.assets.length, 0);
  } finally {
    await fx.db.close();
  }
});

test("asset endpoint resolves or answers 404", async () => {
  const fx = await fixture();
  try {
    const ok = await getAssetRoute(fx.db, fx.icon.artifactId);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.asset.uri, `skelet://artifact/${fx.icon.artifactId}`);
    assert.equal((await getAssetRoute(fx.db, "not-a-uuid")).status, 404);
    assert.equal(
      (await getAssetRoute(fx.db, "00000000-0000-0000-0000-000000000000")).status,
      404,
    );
  } finally {
    await fx.db.close();
  }
});

test("object endpoint recovers artifacts and gates packs", async () => {
  const fx = await fixture();
  try {
    const artifact = await getObjectRoute(fx.db, `skelet://artifact/${fx.icon.artifactId}`, fx.owner.id);
    assert.equal(artifact.status, 200);
    assert.equal(artifact.body.object.title, "REST arrow");
    assert.equal((await getObjectRoute(fx.db, undefined, fx.owner.id)).status, 400);
    assert.equal((await getObjectRoute(fx.db, "bogus", fx.owner.id)).status, 400);
    assert.equal(
      (await getObjectRoute(fx.db, "skelet://artifact/00000000-0000-0000-0000-000000000000", fx.owner.id)).status,
      404,
    );
    const pack = await createReferencePack(fx.db, {
      workspaceId: fx.space.workspace.id,
      title: "REST pack",
      actorId: fx.owner.id,
      artifactIds: [fx.icon.artifactId],
    });
    const denied = await getObjectRoute(fx.db, pack.uri, fx.outsider.id);
    assert.equal(denied.status, 404);
    const allowed = await getObjectRoute(fx.db, pack.uri, fx.owner.id);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.pack.itemCount, 1);
    assert.equal(allowed.body.pack.items[0].uri, `skelet://artifact/${fx.icon.artifactId}`);
  } finally {
    await fx.db.close();
  }
});
