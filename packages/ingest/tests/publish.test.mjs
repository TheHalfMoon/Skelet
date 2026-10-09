import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDatabase } from "../../db/src/db.ts";
import { migrateUp } from "../../db/src/migrate.ts";
import { createProduct, createProductVersion, createSource } from "../../db/src/repositories.ts";
import { LocalContentAddressedStorage } from "../../storage/src/storage.ts";
import {
  PublishError,
  publishArtifact,
} from "../src/pipeline.ts";

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const source = await createSource(db, { key: "pipeline-source", kind: "synthetic" });
  const product = await createProduct(db, { sourceId: source.id, title: "Pipeline app" });
  const version = await createProductVersion(db, { productId: product.id, versionNo: 1 });
  const root = await mkdtemp(join(tmpdir(), "skelet-ingest-"));
  const storage = new LocalContentAddressedStorage({ rootDir: root });
  return { db, source, product, version, storage, root };
}

async function teardown(fixture) {
  await fixture.db.close();
  await rm(fixture.root, { recursive: true, force: true });
}

function enricher(id, behavior) {
  return {
    id,
    capability: "test-enrichment",
    version: "fixture:1",
    egress: "none",
    config: {},
    invoke: behavior,
    health: async () => ({ ok: true }),
    provenance: () => ({}),
  };
}

const BYTES = new TextEncoder().encode("pipeline-fixture-bytes");

test("happy path publishes artifact and deduplicated asset", async () => {
  const fx = await fixture();
  try {
    const first = await publishArtifact(fx.db, fx.storage, {
      sourceId: fx.source.id,
      productId: fx.product.id,
      productVersionId: fx.version.id,
      kind: "screen",
      title: "Onboarding",
      rightsClassification: "metadata_only",
      asset: { bytes: BYTES, mediaType: "image/png" },
      enrichers: [enricher("good", async () => ({ tags: ["onboarding"] }))],
    });
    assert.equal(first.status, "published");
    assert.ok(first.assetId !== null);
    assert.equal(first.assetDeduplicated, false);
    assert.deepEqual(first.enrichment, [
      { providerId: "good", capability: "test-enrichment", ok: true },
    ]);
    const second = await publishArtifact(fx.db, fx.storage, {
      sourceId: fx.source.id,
      kind: "screen",
      title: "Onboarding copy",
      rightsClassification: "metadata_only",
      asset: { bytes: BYTES, mediaType: "image/png" },
    });
    assert.equal(second.assetId, first.assetId);
    assert.equal(second.assetDeduplicated, true);
    const assets = await fx.db.query("select count(*)::int as n from assets");
    assert.equal(assets.rows[0]?.n, 1);
    const artifacts = await fx.db.query("select count(*)::int as n from artifacts");
    assert.equal(artifacts.rows[0]?.n, 2);
  } finally {
    await teardown(fx);
  }
});

test("required validation failures publish nothing", async () => {
  const fx = await fixture();
  try {
    const alien = await createSource(fx.db, { key: "alien", kind: "synthetic" });
    const cases = [
      { kind: "spaceship", title: "Bad kind", rightsClassification: "metadata_only" },
      { kind: "screen", title: "   ", rightsClassification: "metadata_only" },
      { kind: "screen", title: "Bad rights", rightsClassification: "all-yours" },
      {
        kind: "screen",
        title: "Ghost source",
        rightsClassification: "metadata_only",
        sourceId: "00000000-0000-0000-0000-000000000000",
      },
      {
        kind: "screen",
        title: "Alien product",
        rightsClassification: "metadata_only",
        productId: fx.product.id,
        sourceId: alien.id,
      },
      {
        kind: "screen",
        title: "Version without product",
        rightsClassification: "metadata_only",
        productVersionId: fx.version.id,
      },
      {
        kind: "screen",
        title: "Bad asset",
        rightsClassification: "metadata_only",
        asset: { bytes: new Uint8Array(0), mediaType: "image/png" },
      },
      {
        kind: "screen",
        title: "Bad media",
        rightsClassification: "metadata_only",
        asset: { bytes: BYTES, mediaType: "not-a-type!!" },
      },
      {
        kind: "screen",
        title: "Big metadata",
        rightsClassification: "metadata_only",
        metadata: { blob: "x".repeat(40000) },
      },
      {
        kind: "screen",
        title: "Proto metadata",
        rightsClassification: "metadata_only",
        metadata: JSON.parse('{"__proto__":{"polluted":true}}'),
      },
      {
        kind: "screen",
        title: "Long summary",
        rightsClassification: "metadata_only",
        summary: "x".repeat(5000),
      },
      {
        kind: "screen",
        title: "Bad URL",
        rightsClassification: "metadata_only",
        asset: { bytes: BYTES, mediaType: "image/png", sourceUrl: "file:///etc/passwd" },
      },
      {
        kind: "screen",
        title: "Too many enrichers",
        rightsClassification: "metadata_only",
        enrichers: Array.from({ length: 11 }, (_, index) => enricher(`e${index}`, async () => ({}))),
      },
    ];
    for (const overrides of cases) {
      await assert.rejects(
        () =>
          publishArtifact(fx.db, fx.storage, {
            sourceId: fx.source.id,
            kind: "screen",
            title: "Fallback",
            rightsClassification: "metadata_only",
            ...overrides,
          }),
        (error) => error instanceof PublishError,
        `case must fail closed: ${overrides.title}`,
      );
    }
    const artifacts = await fx.db.query("select count(*)::int as n from artifacts");
    assert.equal(artifacts.rows[0]?.n, 0);
    const assets = await fx.db.query("select count(*)::int as n from assets");
    assert.equal(assets.rows[0]?.n, 0);
  } finally {
    await teardown(fx);
  }
});

test("optional enricher failures yield partial without corrupting publish", async () => {
  const fx = await fixture();
  try {
    const result = await publishArtifact(fx.db, fx.storage, {
      sourceId: fx.source.id,
      kind: "component",
      title: "Button",
      rightsClassification: "permitted",
      asset: { bytes: BYTES, mediaType: "image/svg+xml" },
      enrichers: [
        enricher("good", async () => ({ ok: true })),
        enricher("bad", async () => {
          throw new Error("enricher exploded");
        }),
      ],
    });
    assert.equal(result.status, "partial");
    assert.equal(result.enrichment.length, 2);
    assert.deepEqual(result.enrichment[0], {
      providerId: "good",
      capability: "test-enrichment",
      ok: true,
    });
    assert.equal(result.enrichment[1]?.ok, false);
    assert.equal(result.enrichment[1]?.errorCode, "provider/failed");
    const artifact = await fx.db.query(
      "select metadata from artifacts where id = $1",
      [result.artifactId],
    );
    assert.deepEqual(artifact.rows[0]?.metadata, {});
  } finally {
    await teardown(fx);
  }
});

test("enricher timeouts degrade to partial", async () => {
  const fx = await fixture();
  try {
    const result = await publishArtifact(fx.db, fx.storage, {
      sourceId: fx.source.id,
      kind: "page",
      title: "Slow page",
      rightsClassification: "metadata_only",
      enrichers: [
        enricher("slow", async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return {};
        }),
      ],
      enricherTimeoutMs: 50,
    });
    assert.equal(result.status, "partial");
    assert.equal(result.enrichment[0]?.errorCode, "provider/timeout");
    assert.notEqual(result.artifactId, null);
  } finally {
    await teardown(fx);
  }
});

test("conflicting source or rights fail closed without inheriting", async () => {
  const fx = await fixture();
  try {
    const other = await createSource(fx.db, { key: "other-source", kind: "synthetic" });
    const first = await publishArtifact(fx.db, fx.storage, {
      sourceId: fx.source.id,
      kind: "icon",
      title: "Mark",
      rightsClassification: "restricted",
      asset: { bytes: BYTES, mediaType: "image/svg+xml" },
    });
    assert.equal(first.status, "published");
    const conflict = await publishArtifact(fx.db, fx.storage, {
      sourceId: other.id,
      kind: "icon",
      title: "Mark",
      rightsClassification: "metadata_only",
      asset: { bytes: BYTES, mediaType: "image/svg+xml" },
    }).then(
      () => { throw new Error("conflicting rights must fail"); },
      (failure) => failure,
    );
    assert.ok(conflict instanceof PublishError);
    assert.equal(conflict.code, "publish/rights-conflict");
    const artifacts = await fx.db.query("select count(*)::int as n from artifacts");
    assert.equal(artifacts.rows[0]?.n, 1);
    const row = await fx.db.query("select source_id, rights_classification from assets where id = $1", [
      first.assetId,
    ]);
    assert.equal(row.rows[0]?.source_id, fx.source.id);
    assert.equal(row.rows[0]?.rights_classification, "restricted");
  } finally {
    await teardown(fx);
  }
});

test("storage failures carry a generic message", async () => {
  const fx = await fixture();
  try {
    const error = await publishArtifact(fx.db, fx.storage, {
      sourceId: fx.source.id,
      kind: "icon",
      title: "Heavy",
      rightsClassification: "permitted",
      asset: { bytes: BYTES, mediaType: "image/png" },
      storageMaxBytes: 4,
    }).then(
      () => { throw new Error("oversize asset must fail"); },
      (failure) => failure,
    );
    assert.ok(error instanceof PublishError);
    assert.equal(error.message, "Asset storage failed.");
  } finally {
    await teardown(fx);
  }
});

test("media types normalize and oversize assets fail by default", async () => {
  const fx = await fixture();
  try {
    const result = await publishArtifact(fx.db, fx.storage, {
      sourceId: fx.source.id,
      kind: "icon",
      title: "Uppercase",
      rightsClassification: "permitted",
      asset: { bytes: BYTES, mediaType: "IMAGE/PNG" },
    });
    assert.equal(result.status, "published");
    const row = await fx.db.query("select media_type from assets where id = $1", [result.assetId]);
    assert.equal(row.rows[0]?.media_type, "image/png");
  } finally {
    await teardown(fx);
  }
});

test("storage failures publish nothing", async () => {
  const fx = await fixture();
  try {
    await assert.rejects(
      () =>
        publishArtifact(fx.db, fx.storage, {
          sourceId: fx.source.id,
          kind: "icon",
          title: "Heavy icon",
          rightsClassification: "permitted",
          asset: { bytes: BYTES, mediaType: "image/png" },
          storageMaxBytes: 4,
        }),
      (error) => error instanceof PublishError && error.code === "publish/storage-failed",
    );
    const artifacts = await fx.db.query("select count(*)::int as n from artifacts");
    assert.equal(artifacts.rows[0]?.n, 0);
    const assets = await fx.db.query("select count(*)::int as n from assets");
    assert.equal(assets.rows[0]?.n, 0);
  } finally {
    await teardown(fx);
  }
});
