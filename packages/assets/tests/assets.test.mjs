import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../db/src/db.ts";
import { migrateUp } from "../../db/src/migrate.ts";
import { createSource } from "../../db/src/repositories.ts";
import {
  RegistryError,
  registerAsset,
  resolveAsset,
  searchAssets,
  servingPolicy,
} from "../src/registry.ts";

const ICON_HASH = "1".repeat(64);
const LOGO_HASH = "2".repeat(64);

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const source = await createSource(db, { key: "registry-source", kind: "synthetic" });
  return { db, source };
}

test("serving policy fails closed on rights, license, and trademark", () => {
  assert.deepEqual(
    servingPolicy({ rightsClassification: "permitted", license: "MIT", trademark: false }),
    { serving: "download", reason: "Permitted rights with a redistributable license." },
  );
  assert.equal(
    servingPolicy({ rightsClassification: "restricted", license: "MIT", trademark: false }).serving,
    "metadata-only",
  );
  assert.equal(
    servingPolicy({ rightsClassification: "permitted", license: "unknown", trademark: false }).serving,
    "metadata-only",
  );
  assert.equal(
    servingPolicy({ rightsClassification: "permitted", license: "CC-BY-4.0", trademark: false }).serving,
    "metadata-only",
  );
  assert.equal(
    servingPolicy({ rightsClassification: "permitted", license: "MIT", trademark: true }).serving,
    "metadata-only",
  );
});

test("one query searches icons, logos, and fonts", async () => {
  const fx = await fixture();
  try {
    await registerAsset(fx.db, {
      kind: "icon",
      title: "Arrow right",
      sourceId: fx.source.id,
      contentHash: ICON_HASH,
      rightsClassification: "permitted",
      metadata: { collection: "iconify:mdi", ref: "arrow-right", tags: ["arrow", "direction"], license: "Apache-2.0" },
      asset: { sha256: ICON_HASH, mediaType: "image/svg+xml", byteLength: 214, storageKey: "sha256/ar/arrow" },
    });
    await registerAsset(fx.db, {
      kind: "logo",
      title: "Arrow brand mark",
      sourceId: fx.source.id,
      contentHash: LOGO_HASH,
      rightsClassification: "restricted",
      metadata: {
        collection: "brand-corpus",
        ref: "arrow-inc",
        tags: ["arrow", "brand"],
        license: "proprietary",
        trademark: true,
        trademarkGuidelinesUrl: "https://example.org/brand",
        variants: ["mark", "wordmark", "monochrome"],
      },
    });
    await registerAsset(fx.db, {
      kind: "font",
      title: "Arrow Sans",
      sourceId: fx.source.id,
      contentHash: "3".repeat(64),
      rightsClassification: "permitted",
      metadata: { collection: "fontsource", ref: "arrow-sans", tags: ["arrow", "sans"], license: "OFL-1.1" },
    });
    const results = await searchAssets(fx.db, { query: "arrow" });
    assert.equal(results.length, 3);
    assert.deepEqual(results.map((entry) => entry.kind).sort(), ["font", "icon", "logo"]);
    for (const entry of results) {
      assert.equal(entry.sourceKey, "registry-source");
      assert.ok(entry.servingReason.length > 0);
    }
    const icons = await searchAssets(fx.db, { query: "arrow", kinds: ["icon"] });
    assert.deepEqual(icons.map((entry) => entry.kind), ["icon"]);
    const free = await searchAssets(fx.db, { query: "arrow", trademarkFree: true });
    assert.equal(free.some((entry) => entry.trademark), false);
    assert.equal(free.length, 2);
    const mit = await searchAssets(fx.db, { query: "arrow", licenses: ["Apache-2.0"] });
    assert.equal(mit.length, 1);
    const collection = await searchAssets(fx.db, { query: "arrow", collection: "fontsource" });
    assert.equal(collection.length, 1);
  } finally {
    await fx.db.close();
  }
});

test("resolution gates bytes by policy", async () => {
  const fx = await fixture();
  try {
    const icon = await registerAsset(fx.db, {
      kind: "icon",
      title: "Check mark",
      sourceId: fx.source.id,
      contentHash: ICON_HASH,
      rightsClassification: "permitted",
      metadata: { collection: "iconify:mdi", ref: "check", tags: ["check"], license: "MIT" },
      asset: { sha256: ICON_HASH, mediaType: "image/svg+xml", byteLength: 190, storageKey: "sha256/ch/check" },
    });
    assert.equal(icon.serving, "download");
    const resolved = await resolveAsset(fx.db, icon.artifactId);
    assert.equal(resolved.contentHash, ICON_HASH);
    const logo = await registerAsset(fx.db, {
      kind: "logo",
      title: "Acme mark",
      sourceId: fx.source.id,
      contentHash: LOGO_HASH,
      rightsClassification: "restricted",
      metadata: { license: "proprietary", trademark: true },
    });
    assert.equal(logo.serving, "metadata-only");
    assert.equal(
      (await resolveAsset(fx.db, logo.artifactId)).servingReason,
      "Trademark claim requires brand-owner permission.",
    );
    const screen = await fx.db.query(
      "select id from artifacts where kind = 'screen' limit 1",
    );
    assert.equal(screen.rows.length, 0);
    await assert.rejects(
      () => resolveAsset(fx.db, "not-a-uuid"),
      (error) => error instanceof RegistryError && error.code === "assets/not-found",
    );
    await assert.rejects(
      () => resolveAsset(fx.db, "00000000-0000-0000-0000-000000000000"),
      (error) => error instanceof RegistryError && error.code === "assets/not-found",
    );
  } finally {
    await fx.db.close();
  }
});

test("registration validates shapes and provenance", async () => {
  const fx = await fixture();
  try {
    await assert.rejects(
      () =>
        registerAsset(fx.db, {
          kind: "screen",
          title: "Wrong kind",
          sourceId: fx.source.id,
          contentHash: ICON_HASH,
          rightsClassification: "permitted",
        }),
      (error) => error instanceof RegistryError && error.code === "assets/invalid-record",
    );
    await assert.rejects(
      () =>
        registerAsset(fx.db, {
          kind: "icon",
          title: "Bad tags",
          sourceId: fx.source.id,
          contentHash: ICON_HASH,
          rightsClassification: "permitted",
          metadata: { tags: ["ok", 42] },
        }),
      (error) => error instanceof RegistryError && error.code === "assets/invalid-record",
    );
    await assert.rejects(
      () => searchAssets(fx.db, { query: "   " }),
      (error) => error instanceof RegistryError && error.code === "assets/invalid-record",
    );
    await assert.rejects(
      () => searchAssets(fx.db, { query: "x", limit: 500 }),
      (error) => error instanceof RegistryError && error.code === "assets/invalid-record",
    );
  } finally {
    await fx.db.close();
  }
});
