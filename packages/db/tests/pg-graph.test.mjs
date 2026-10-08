import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/db.ts";
import { migrateDown, migrateUp } from "../src/migrate.ts";
import { createSource, createProduct, createProductVersion } from "../src/repositories.ts";
import { createArtifact, createAsset, createPattern, createRelation, getAssetByHash } from "../src/graph.ts";

const url = process.env.SKELET_TEST_DATABASE_URL;
const enabled = Boolean(url);

function verifyFixture() {
  if (!url || process.env.SKELET_DB_TEST_CONFIRM !== "yes") throw new Error("Fixture confirmation required");
  const u = new URL(url);
  if (!["127.0.0.1","localhost"].includes(u.hostname) ||
    u.pathname !== "/skelet_test" || u.username !== "skelet_test") {
    throw new Error("Refusing to run on non-fixture PostgreSQL");
  }
}

test("real PostgreSQL round-trips design graph and blocks invalid raw SQL", { skip: !enabled }, async () => {
  verifyFixture();
  const db = await openDatabase({ connectionString: url });
  try {
    assert.deepEqual(await migrateUp(db), ["001_sources_products", "002_design_graph"]);
    const source = await createSource(db,{key:"pg-fixture",kind:"test"});
    const product = await createProduct(db,{sourceId:source.id,title:"Real PostgreSQL"});
    const version = await createProductVersion(db,{productId:product.id,versionNo:1});
    const hash="a".repeat(64);
    const artifact=await createArtifact(db,{sourceId:source.id,productId:product.id,
      productVersionId:version.id,kind:"screen",title:"Real screen",
      contentHash:hash,rightsClassification:"permitted",visibility:"public"});
    const asset=await createAsset(db,{sha256:hash,mediaType:"image/png",byteLength:17,
      storageKey:"fixtures/hash",sourceId:source.id,rightsClassification:"restricted"});
    const pattern=await createPattern(db,{slug:"screen-layout",title:"Screen layout",sourceId:source.id});
    const edge=await createRelation(db,{fromType:"artifact",fromId:artifact.id,
      relationType:"uses",toType:"pattern",toId:pattern.id,confidence:0.5});
    assert.equal(edge.toId,pattern.id);
    assert.equal((await getAssetByHash(db,hash)).id,asset.id);
    await assert.rejects(
      () => db.query("delete from artifacts where id=$1",[artifact.id]),
      /graph endpoint still referenced/,
    );
    await assert.rejects(
      () => db.query("insert into relations(from_type,from_id,relation_type,to_type,to_id) values('artifact',$1,'uses','pattern',$2)",[
        artifact.id,"00000000-0000-4000-8000-000000000000",
      ]),
      /graph relation target endpoint not found/,
    );
    await assert.rejects(
      () => db.query("insert into artifacts(id,kind,title,source_id,content_hash,rights_classification,visibility) values($1,'screen','Invalid',$2,$3,'restricted','public')",[
        "0199d8d7-8000-7000-8000-000000000001", source.id, hash,
      ]),
      /check|violates/i,
    );
  } finally {
    await migrateDown(db);
    await db.close();
  }
});
