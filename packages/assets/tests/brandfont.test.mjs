import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../db/src/db.ts";
import { migrateUp } from "../../db/src/migrate.ts";
import { createSource } from "../../db/src/repositories.ts";
import { IconSetError } from "../src/iconset.ts";
import { resolveAsset, searchAssets } from "../src/registry.ts";
import { importBrandMarks, importFonts } from "../src/brandfont.ts";

const MARK_BODY = '<path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z"/>';
const EVIL_BODY = '<g><animate attributeName="x" values="0;1" dur="1s"/></g>';

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const source = await createSource(db, { key: "brandfont-source", kind: "synthetic" });
  return { db, source };
}

function marks() {
  return [
    {
      slug: "acme",
      title: "Acme Corporation",
      guidelinesUrl: "https://acme.example/brand",
      license: "proprietary",
      variants: [
        { name: "mark", svgBody: MARK_BODY },
        { name: "wordmark", svgBody: MARK_BODY },
      ],
    },
    {
      slug: "evil",
      title: "Evil mark",
      variants: [{ name: "mark", svgBody: EVIL_BODY }],
    },
  ];
}

function families() {
  return [
    {
      family: "Grotesk",
      license: "OFL-1.1",
      sourceUrl: "https://example.org/fonts/grotesk",
      styles: [
        { name: "Regular", weight: 400, style: "normal" },
        { name: "Bold Italic", weight: 700, style: "italic" },
      ],
    },
    {
      family: "Broken",
      styles: [{ name: "Weird", weight: 5000, style: "normal" }],
    },
  ];
}

test("brand dry-run validates without writing", async () => {
  const fx = await fixture();
  try {
    const report = await importBrandMarks(fx.db, {
      sourceId: fx.source.id,
      version: "1.0.0",
      rightsClassification: "restricted",
      marks: marks(),
      dryRun: true,
    });
    assert.equal(report.total, 2);
    assert.deepEqual(report.imported, []);
    assert.equal(report.rejected.length, 1);
    assert.equal(report.rejected[0]?.name, "evil");
    const artifacts = await fx.db.query("select count(*)::int as n from artifacts");
    assert.equal(artifacts.rows[0]?.n, 0);
  } finally {
    await fx.db.close();
  }
});

test("brand marks import trademark-separated with variants", async () => {
  const fx = await fixture();
  try {
    const report = await importBrandMarks(fx.db, {
      sourceId: fx.source.id,
      version: "1.0.0",
      rightsClassification: "restricted",
      marks: marks(),
    });
    assert.deepEqual(report.imported, ["acme"]);
    const found = await searchAssets(fx.db, { query: "acme" });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.kind, "logo");
    assert.equal(found[0]?.trademark, true);
    assert.equal(found[0]?.trademarkGuidelinesUrl, "https://acme.example/brand");
    assert.deepEqual(found[0]?.variants.sort(), ["mark", "wordmark"]);
    assert.equal(found[0]?.serving, "metadata-only");
    const resolved = await resolveAsset(fx.db, found[0].artifactId);
    assert.equal(resolved.serving, "metadata-only");
    const again = await importBrandMarks(fx.db, {
      sourceId: fx.source.id,
      version: "1.0.0",
      rightsClassification: "restricted",
      marks: marks(),
    });
    assert.deepEqual(again.imported, []);
    assert.ok(again.skipped.includes("acme"));
    const logos = await fx.db.query(
      "select count(*)::int as n from artifacts where kind = 'logo'",
    );
    assert.equal(logos.rows[0]?.n, 1);
  } finally {
    await fx.db.close();
  }
});

test("brand input validation fails closed", async () => {
  const fx = await fixture();
  try {
    await assert.rejects(
      () =>
        importBrandMarks(fx.db, {
          sourceId: fx.source.id,
          version: "1.0.0",
          rightsClassification: "restricted",
          marks: [],
        }),
      (error) => error instanceof IconSetError,
    );
    const bad = await importBrandMarks(fx.db, {
      sourceId: fx.source.id,
      version: "1.0.0",
      rightsClassification: "restricted",
      marks: [
        { slug: "bad slug!", title: "Spaced", variants: [{ name: "m", svgBody: MARK_BODY }] },
        { slug: "__proto__", title: "Reserved", variants: [{ name: "m", svgBody: MARK_BODY }] },
        { slug: "ok", title: "Ok", guidelinesUrl: "ftp://evil.example/x", variants: [{ name: "m", svgBody: MARK_BODY }] },
      ],
    });
    assert.deepEqual(bad.imported, []);
    assert.equal(bad.rejected.length, 3);
    const dupes = await importBrandMarks(fx.db, {
      sourceId: fx.source.id,
      version: "1.0.0",
      rightsClassification: "restricted",
      marks: [
        {
          slug: "dupe",
          title: "Dupe",
          variants: [
            { name: "mark", svgBody: MARK_BODY },
            { name: "mark", svgBody: MARK_BODY },
          ],
        },
      ],
    });
    assert.deepEqual(dupes.imported, []);
    assert.equal(dupes.rejected.length, 1);
  } finally {
    await fx.db.close();
  }
});

test("fonts import metadata-only with style inventories", async () => {
  const fx = await fixture();
  try {
    const report = await importFonts(fx.db, {
      sourceId: fx.source.id,
      version: "1.0.0",
      rightsClassification: "permitted",
      families: families(),
    });
    assert.deepEqual(report.imported, ["Grotesk"]);
    assert.equal(report.rejected.length, 1);
    const found = await searchAssets(fx.db, { query: "grotesk" });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.kind, "font");
    assert.equal(found[0]?.license, "OFL-1.1");
    assert.deepEqual(found[0]?.variants.sort(), ["Bold Italic:700:italic", "Regular:400:normal"]);
    assert.equal(found[0]?.serving, "metadata-only");
    assert.equal(found[0]?.servingReason, "No distributable bytes registered.");
    const revised = await importFonts(fx.db, {
      sourceId: fx.source.id,
      version: "2.0.0",
      rightsClassification: "permitted",
      families: [
        {
          family: "Grotesk",
          license: "OFL-1.1",
          styles: [
            { name: "Regular", weight: 400, style: "normal" },
            { name: "Light", weight: 300, style: "normal" },
          ],
        },
      ],
    });
    assert.deepEqual(revised.imported, ["Grotesk"]);
    const versions = await fx.db.query(
      "select content_hash from artifacts where kind = 'font' order by created_at",
    );
    assert.equal(versions.rows.length, 2);
    assert.notEqual(versions.rows[0]?.content_hash, versions.rows[1]?.content_hash);
    const dupes = await importFonts(fx.db, {
      sourceId: fx.source.id,
      version: "3.0.0",
      rightsClassification: "permitted",
      families: [
        {
          family: "Dupe",
          styles: [
            { name: "Regular", weight: 400, style: "normal" },
            { name: "Regular", weight: 400, style: "normal" },
          ],
        },
      ],
    });
    assert.deepEqual(dupes.imported, []);
    assert.equal(dupes.rejected.length, 1);
    const dry = await importFonts(fx.db, {
      sourceId: fx.source.id,
      version: "1.0.0",
      rightsClassification: "permitted",
      families: families(),
      dryRun: true,
    });
    assert.deepEqual(dry.imported, []);
    const fonts = await fx.db.query(
      "select count(*)::int as n from artifacts where kind = 'font'",
    );
    assert.equal(fonts.rows[0]?.n, 2);
  } finally {
    await fx.db.close();
  }
});
