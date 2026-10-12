import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../db/src/db.ts";
import { migrateUp } from "../../db/src/migrate.ts";
import { createSource } from "../../db/src/repositories.ts";
import { signUp } from "../../db/src/auth.ts";
import { createWorkspace } from "../../db/src/workspaces.ts";
import {
  RegistryError,
  registerAsset,
  searchAssets,
  searchAssetsDetailed,
  searchAssetsForActor,
  searchAssetsForActorDetailed,
} from "../src/registry.ts";

const HASH = (char) => char.repeat(64);

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const source = await createSource(db, { key: "af04-search-source", kind: "synthetic" });
  return { db, source };
}

async function seedBaseline(db, source) {
  await registerAsset(db, {
    kind: "icon",
    title: "Arrow right",
    sourceId: source.id,
    contentHash: HASH("1"),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "arrow-right", tags: ["arrow", "direction"], license: "Apache-2.0" },
    asset: { sha256: HASH("1"), mediaType: "image/svg+xml", byteLength: 214, storageKey: "sha256/af04/arrow" },
  });
  await registerAsset(db, {
    kind: "logo",
    title: "Arrow brand mark",
    sourceId: source.id,
    contentHash: HASH("2"),
    rightsClassification: "restricted",
    metadata: {
      collection: "brand-corpus",
      ref: "arrow-inc",
      tags: ["arrow", "brand"],
      license: "proprietary",
      trademark: true,
      trademarkGuidelinesUrl: "https://example.org/brand",
    },
  });
  await registerAsset(db, {
    kind: "font",
    title: "Arrow Sans",
    sourceId: source.id,
    contentHash: HASH("3"),
    rightsClassification: "permitted",
    metadata: { collection: "fontsource", ref: "arrow-sans", tags: ["arrow", "sans"], license: "OFL-1.1" },
  });
  // Tag-only match: title does not contain the query token, tag does.
  await registerAsset(db, {
    kind: "icon",
    title: "Sans serif",
    sourceId: source.id,
    contentHash: HASH("4"),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "sans-serif", tags: ["arrow"], license: "MIT" },
    asset: { sha256: HASH("4"), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/af04/sans" },
  });
}

test("AF-04 invalid inputs fail with assets/invalid-record", async () => {
  const fx = await fixture();
  try {
    await seedBaseline(fx.db, fx.source);
    const bad = [
      () => searchAssets(fx.db, { query: "   " }),
      () => searchAssets(fx.db, { query: "" }),
      () => searchAssets(fx.db, { query: "x".repeat(201) }),
      () => searchAssets(fx.db, { query: "arrow", limit: 0 }),
      () => searchAssets(fx.db, { query: "arrow", limit: 51 }),
      () => searchAssets(fx.db, { query: "arrow", limit: 1.5 }),
      () => searchAssets(fx.db, { query: "arrow", offset: -1 }),
      () => searchAssets(fx.db, { query: "arrow", offset: 1_000_001 }),
      () => searchAssets(fx.db, { query: "arrow", offset: 1.5 }),
      () => searchAssets(fx.db, { query: "arrow", kinds: [] }),
      () => searchAssets(fx.db, { query: "arrow", kinds: ["spaceship"] }),
      () => searchAssets(fx.db, { query: "arrow", kinds: ["icon", "icon"] }),
      () => searchAssets(fx.db, { query: "arrow", kinds: ["icon", "logo", "font", "icon"] }),
      () => searchAssets(fx.db, { query: "arrow", rights: [] }),
      () => searchAssets(fx.db, { query: "arrow", rights: ["classified"] }),
      () => searchAssets(fx.db, { query: "arrow", rights: ["permitted", "permitted"] }),
      () => searchAssets(fx.db, { query: "arrow", rights: ["unknown", "metadata_only", "permitted", "restricted", "extra"] }),
      () => searchAssets(fx.db, { query: "arrow", licenses: [] }),
      () => searchAssets(fx.db, { query: "arrow", licenses: [""] }),
      () => searchAssets(fx.db, { query: "arrow", licenses: ["x".repeat(65)] }),
      () => searchAssets(fx.db, { query: "arrow", licenses: ["MIT", "MIT"] }),
      () => searchAssets(fx.db, { query: "arrow", licenses: new Array(33).fill("MIT") }),
      () => searchAssets(fx.db, { query: "arrow", trademarkFree: "yes" }),
      () => searchAssets(fx.db, { query: "arrow", collection: "" }),
      () => searchAssets(fx.db, { query: "arrow", collection: "   " }),
      () => searchAssets(fx.db, { query: "arrow", collection: "x".repeat(201) }),
      () => searchAssets(fx.db, { query: "arrow", includeFacets: "yes" }),
    ];
    for (const [index, fn] of bad.entries()) {
      await assert.rejects(
        fn,
        (error) => error instanceof RegistryError && error.code === "assets/invalid-record",
        `bad case ${index} should reject`,
      );
    }
  } finally {
    await fx.db.close();
  }
});

test("AF-04 wildcard and punctuation match literally", async () => {
  const fx = await fixture();
  try {
    await seedBaseline(fx.db, fx.source);
    const percent = await searchAssets(fx.db, { query: "%" });
    assert.equal(percent.length, 0);
    const underscore = await searchAssets(fx.db, { query: "arrow_right" });
    assert.equal(underscore.length, 0);
    const backslash = await searchAssets(fx.db, { query: "arrow\\right" });
    assert.equal(backslash.length, 0);
    // Punctuation queries use the deterministic literal path.
    const detailed = await searchAssetsDetailed(fx.db, { query: "arrow_right" });
    assert.equal(detailed.searchMode, "literal-like");
    assert.equal(detailed.assets.length, 0);
    // Plain token queries use PostgreSQL FTS.
    const plain = await searchAssetsDetailed(fx.db, { query: "arrow" });
    assert.equal(plain.searchMode, "postgres-fts");
    assert.ok(plain.assets.length >= 3);
  } finally {
    await fx.db.close();
  }
});

test("AF-04 ranking prefers title matches before tag-only matches with stable tie-break", async () => {
  const fx = await fixture();
  try {
    await seedBaseline(fx.db, fx.source);
    const detailed = await searchAssetsDetailed(fx.db, { query: "arrow" });
    assert.equal(detailed.searchMode, "postgres-fts");
    const titles = detailed.assets.map((entry) => entry.title);
    // Tag-only "Sans serif" must come after all title matches.
    assert.ok(titles.indexOf("Sans serif") > titles.indexOf("Arrow right"));
    assert.ok(titles.indexOf("Sans serif") > titles.indexOf("Arrow Sans"));
    // Deterministic repeat: same query yields identical order.
    const again = await searchAssetsDetailed(fx.db, { query: "arrow" });
    assert.deepEqual(again.assets.map((entry) => entry.artifactId), detailed.assets.map((entry) => entry.artifactId));
    // Tie-break is title then id: verify sorted titles for equal-rank group.
    const firstThree = detailed.assets.slice(0, 3).map((entry) => entry.title);
    const sorted = [...firstThree].sort();
    assert.deepEqual(firstThree, sorted);
  } finally {
    await fx.db.close();
  }
});

test("AF-04 filters are typed and validated", async () => {
  const fx = await fixture();
  try {
    await seedBaseline(fx.db, fx.source);
    const icons = await searchAssets(fx.db, { query: "arrow", kinds: ["icon"] });
    assert.ok(icons.length >= 1);
    assert.ok(icons.every((entry) => entry.kind === "icon"));
    const restricted = await searchAssets(fx.db, { query: "arrow", rights: ["restricted"] });
    assert.deepEqual(restricted.map((entry) => entry.kind), ["logo"]);
    const mit = await searchAssets(fx.db, { query: "arrow", licenses: ["Apache-2.0"] });
    assert.equal(mit.length, 1);
    assert.equal(mit[0].license, "Apache-2.0");
    const free = await searchAssets(fx.db, { query: "arrow", trademarkFree: true });
    assert.ok(free.every((entry) => entry.trademark === false));
    const marked = await searchAssets(fx.db, { query: "arrow", trademarkFree: false });
    assert.ok(marked.length >= 1);
    assert.ok(marked.every((entry) => entry.trademark === true));
    const collection = await searchAssets(fx.db, { query: "arrow", collection: "fontsource" });
    assert.equal(collection.length, 1);
    assert.equal(collection[0].collection, "fontsource");
    const combined = await searchAssets(fx.db, {
      query: "arrow",
      kinds: ["icon", "font"],
      rights: ["permitted"],
      trademarkFree: true,
    });
    assert.ok(combined.every((entry) => entry.kind !== "logo" && entry.rightsClassification === "permitted"));
  } finally {
    await fx.db.close();
  }
});

test("AF-04 facets count the access-scoped matched set", async () => {
  const fx = await fixture();
  try {
    await seedBaseline(fx.db, fx.source);
    const detailed = await searchAssetsDetailed(fx.db, { query: "arrow", includeFacets: true });
    assert.ok(detailed.facets !== undefined);
    const kinds = Object.fromEntries(detailed.facets.kinds.map((facet) => [facet.value, facet.count]));
    assert.equal(kinds.icon, 2);
    assert.equal(kinds.logo, 1);
    assert.equal(kinds.font, 1);
    const kindTotal = detailed.facets.kinds.reduce((sum, facet) => sum + facet.count, 0);
    assert.equal(kindTotal, detailed.assets.length);
    // Facets are deterministic: sorted by facet then value.
    assert.deepEqual(detailed.facets.kinds.map((facet) => facet.value), [...detailed.facets.kinds.map((facet) => facet.value)].sort());
    // No facets unless requested.
    const plain = await searchAssetsDetailed(fx.db, { query: "arrow" });
    assert.equal(plain.facets, undefined);
  } finally {
    await fx.db.close();
  }
});

test("AF-04 access isolation applies before rank, pagination, and facets", async () => {
  const fx = await fixture();
  const owner = await signUp(fx.db, { email: "af04-owner@example.com", password: "af04-password-01" });
  const outsider = await signUp(fx.db, { email: "af04-outsider@example.com", password: "af04-password-01" });
  const space = await createWorkspace(fx.db, { name: "AF04 space", ownerId: owner.id });
  try {
    const source = fx.source;
    const global = await registerAsset(fx.db, {
      kind: "icon",
      title: "AF04 global arrow",
      sourceId: source.id,
      contentHash: HASH("a"),
      rightsClassification: "permitted",
      metadata: { collection: "iconify:mdi", ref: "af04-global", tags: ["af04arrow"], license: "MIT" },
      asset: { sha256: HASH("a"), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/af04/global" },
    });
    const priv = await registerAsset(fx.db, {
      kind: "icon",
      title: "AF04 private arrow",
      sourceId: source.id,
      contentHash: HASH("b"),
      rightsClassification: "permitted",
      visibility: "private",
      workspaceId: space.workspace.id,
      ownerSubject: owner.id,
      metadata: { collection: "iconify:mdi", ref: "af04-private", tags: ["af04arrow"], license: "MIT" },
      asset: { sha256: HASH("b"), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/af04/private" },
    });
    const ownerResults = await searchAssetsForActor(fx.db, { query: "af04arrow" }, owner.id);
    assert.ok(ownerResults.some((entry) => entry.artifactId === global.artifactId));
    assert.ok(ownerResults.some((entry) => entry.artifactId === priv.artifactId));
    const outsiderResults = await searchAssetsForActor(fx.db, { query: "af04arrow" }, outsider.id);
    assert.ok(outsiderResults.some((entry) => entry.artifactId === global.artifactId));
    assert.ok(!outsiderResults.some((entry) => entry.artifactId === priv.artifactId));
    // Facet counts never reveal inaccessible rows.
    const ownerFacets = await searchAssetsForActorDetailed(fx.db, { query: "af04arrow", includeFacets: true }, owner.id);
    const outsiderFacets = await searchAssetsForActorDetailed(fx.db, { query: "af04arrow", includeFacets: true }, outsider.id);
    const ownerTotal = ownerFacets.facets.kinds.reduce((sum, facet) => sum + facet.count, 0);
    const outsiderTotal = outsiderFacets.facets.kinds.reduce((sum, facet) => sum + facet.count, 0);
    assert.equal(ownerTotal, 2);
    assert.equal(outsiderTotal, 1);
    // Unscoped search only sees the global corpus.
    const unscoped = await searchAssets(fx.db, { query: "af04arrow" });
    assert.ok(unscoped.some((entry) => entry.artifactId === global.artifactId));
    assert.ok(!unscoped.some((entry) => entry.artifactId === priv.artifactId));
  } finally {
    await fx.db.close();
  }
});

test("AF-04 cursor pagination is stable and deterministic", async () => {
  const fx = await fixture();
  try {
    const source = fx.source;
    for (let index = 0; index < 6; index += 1) {
      await registerAsset(fx.db, {
        kind: "icon",
        title: `AF04 page arrow ${String(index).padStart(2, "0")}`,
        sourceId: source.id,
        contentHash: HASH(String(index)),
        rightsClassification: "permitted",
        metadata: { collection: "iconify:mdi", ref: `af04-page-${index}`, tags: ["af04page"], license: "MIT" },
      });
    }
    const first = await searchAssetsDetailed(fx.db, { query: "af04page", limit: 2, offset: 0 });
    const second = await searchAssetsDetailed(fx.db, { query: "af04page", limit: 2, offset: 2 });
    const third = await searchAssetsDetailed(fx.db, { query: "af04page", limit: 2, offset: 4 });
    assert.equal(first.assets.length, 2);
    assert.equal(second.assets.length, 2);
    assert.equal(third.assets.length, 2);
    const ids = [...first.assets, ...second.assets, ...third.assets].map((entry) => entry.artifactId);
    assert.equal(new Set(ids).size, 6);
    // Full-order read matches paged concatenation.
    const full = await searchAssetsDetailed(fx.db, { query: "af04page", limit: 20, offset: 0 });
    assert.deepEqual(full.assets.map((entry) => entry.artifactId), ids);
  } finally {
    await fx.db.close();
  }
});

test("AF-04 fallback returns literal results only for FTS capability failures", async () => {
  const fx = await fixture();
  try {
    await seedBaseline(fx.db, fx.source);
    const fallbackTx = {
      query: (sql, params) => {
        if (sql.includes("to_tsvector") || sql.includes("plainto_tsquery") || sql.includes("ts_rank")) {
          throw new Error("function to_tsvector(regconfig, text) does not exist");
        }
        return fx.db.query(sql, params);
      },
      exec: (sql) => fx.db.exec(sql),
    };
    const fallback = await searchAssetsDetailed(fallbackTx, { query: "arrow", includeFacets: true });
    assert.equal(fallback.searchMode, "literal-like");
    assert.ok(fallback.assets.length >= 3);
    assert.ok(fallback.facets !== undefined);
    // Arbitrary database failures are never hidden behind the fallback.
    const brokenTx = {
      query: () => {
        throw new Error("connection terminated unexpectedly");
      },
      exec: (sql) => fx.db.exec(sql),
    };
    await assert.rejects(
      () => searchAssetsDetailed(brokenTx, { query: "arrow" }),
      (error) => error instanceof Error && /connection terminated/.test(error.message),
    );
  } finally {
    await fx.db.close();
  }
});
