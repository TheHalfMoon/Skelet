import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDatabase } from "../../db/src/db.ts";
import { migrateUp } from "../../db/src/migrate.ts";
import { createSource } from "../../db/src/repositories.ts";
import { LocalContentAddressedStorage } from "../../storage/src/storage.ts";
import { resolveAsset, searchAssets } from "../src/registry.ts";
import { IconSetError, importIconSet } from "../src/iconset.ts";

const ARROW_BODY = '<path d="M4 12h12l-4-4 1.5-1.5L20 12l-6.5 5.5L12 16l4-4H4z"/>';
const CHECK_BODY = '<path d="M9 16.2l-3.5-3.5L4 14.2 9 19.2 20 8.2l-1.5-1.5z"/>';
const EVIL_BODY = '<path d="M0 0h24v24H0z"/><script>alert(1)</script>';
const HANDLER_BODY = '<rect width="24" height="24" onclick="steal()"/>';

function fixtureSet() {
  return {
    prefix: "fx",
    width: 24,
    height: 24,
    info: { name: "Fixture set", author: "Skelet", license: { title: "MIT", spdx: "MIT" } },
    icons: {
      "arrow-right": { body: ARROW_BODY },
      check: { body: CHECK_BODY, width: 16, height: 16 },
      evil: { body: EVIL_BODY },
      handler: { body: HANDLER_BODY },
      image: { body: '<image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>' },
      styled: { body: '<g style="background:url(https://evil.example/x)"><path d="M0 0h1v1H0z"/></g>' },
      "bad name!": { body: ARROW_BODY },
    },
  };
}

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const source = await createSource(db, { key: "iconset-source", kind: "synthetic" });
  const root = await mkdtemp(join(tmpdir(), "skelet-iconset-"));
  const storage = new LocalContentAddressedStorage({ rootDir: root });
  return { db, source, storage, root };
}

async function teardown(fx) {
  await fx.db.close();
  await rm(fx.root, { recursive: true, force: true });
}

test("dry-run validates without writing", async () => {
  const fx = await fixture();
  try {
    const report = await importIconSet(fx.db, {
      sourceId: fx.source.id,
      setJson: fixtureSet(),
      version: "1.0.0",
      rightsClassification: "permitted",
      storage: fx.storage,
      dryRun: true,
    });
    assert.equal(report.dryRun, true);
    assert.equal(report.total, 7);
    assert.deepEqual(report.imported, []);
    assert.equal(report.rejected.length, 5);
    assert.equal(report.license, "MIT");
    const artifacts = await fx.db.query("select count(*)::int as n from artifacts");
    assert.equal(artifacts.rows[0]?.n, 0);
  } finally {
    await teardown(fx);
  }
});

test("import publishes icons with bytes and attribution", async () => {
  const fx = await fixture();
  try {
    const report = await importIconSet(fx.db, {
      sourceId: fx.source.id,
      setJson: fixtureSet(),
      version: "1.0.0",
      rightsClassification: "permitted",
      storage: fx.storage,
    });
    assert.deepEqual(report.imported.sort(), ["arrow-right", "check"]);
    assert.deepEqual(
      report.rejected.map((entry) => entry.name).sort(),
      ["bad name!", "evil", "handler", "image", "styled"],
    );
    const found = await searchAssets(fx.db, { query: "arrow" });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.collection, "iconify:fx");
    assert.equal(found[0]?.ref, "arrow-right");
    assert.ok(found[0]?.tags.includes("arrow"));
    assert.ok(found[0]?.tags.includes("right"));
    assert.equal(found[0]?.license, "MIT");
    assert.equal(found[0]?.serving, "download");
    const resolved = await resolveAsset(fx.db, found[0].artifactId);
    assert.equal(resolved.contentHash.length, 64);
    const ledger = await fx.db.query(
      "select canonical_id from import_records where external_id = $1",
      ["fx:arrow-right"],
    );
    assert.equal(ledger.rows[0]?.canonical_id, found[0].artifactId);
  } finally {
    await teardown(fx);
  }
});

test("malformed sets fail closed with nothing written", async () => {
  const fx = await fixture();
  try {
    for (const setJson of [
      null,
      { icons: { a: { body: "<path/>" } } },
      { prefix: "Bad Prefix!", icons: { a: { body: "<path/>" } } },
      { prefix: "fx", icons: {} },
      { prefix: "fx", icons: "not-an-object" },
    ]) {
      await assert.rejects(
        () =>
          importIconSet(fx.db, {
            sourceId: fx.source.id,
            setJson,
            version: "1.0.0",
            rightsClassification: "permitted",
          }),
        (error) => error instanceof IconSetError,
      );
    }
    await assert.rejects(
      () =>
        importIconSet(fx.db, {
          sourceId: fx.source.id,
          setJson: fixtureSet(),
          version: "",
          rightsClassification: "permitted",
        }),
      (error) => error instanceof IconSetError,
    );
    const invalidIcons = await importIconSet(fx.db, {
      sourceId: fx.source.id,
      setJson: {
        prefix: "fx",
        icons: {
          empty: { body: "" },
          wide: { body: "<path/>", width: -1 },
          shaped: { body: "<path/>", width: "big" },
        },
      },
      version: "1.0.0",
      rightsClassification: "permitted",
    });
    assert.deepEqual(invalidIcons.imported, []);
    assert.equal(invalidIcons.rejected.length, 3);
    const artifacts = await fx.db.query("select count(*)::int as n from artifacts");
    assert.equal(artifacts.rows[0]?.n, 0);
  } finally {
    await teardown(fx);
  }
});

test("re-imports skip through import records without duplicates", async () => {
  const fx = await fixture();
  try {
    const first = await importIconSet(fx.db, {
      sourceId: fx.source.id,
      setJson: fixtureSet(),
      version: "1.0.0",
      rightsClassification: "permitted",
    });
    assert.equal(first.imported.length, 2);
    const second = await importIconSet(fx.db, {
      sourceId: fx.source.id,
      setJson: fixtureSet(),
      version: "1.0.0",
      rightsClassification: "permitted",
    });
    assert.deepEqual(second.imported, []);
    assert.equal(second.skipped.length, 2);
    const third = await importIconSet(fx.db, {
      sourceId: fx.source.id,
      setJson: fixtureSet(),
      version: "2.0.0",
      rightsClassification: "permitted",
    });
    assert.equal(third.imported.length, 2);
    const artifacts = await fx.db.query(
      "select count(*)::int as n from artifacts where kind = 'icon'",
    );
    assert.equal(artifacts.rows[0]?.n, 4);
  } finally {
    await teardown(fx);
  }
});

test("unknown licenses resolve metadata-only", async () => {
  const fx = await fixture();
  try {
    const set = fixtureSet();
    delete set.info;
    const report = await importIconSet(fx.db, {
      sourceId: fx.source.id,
      setJson: set,
      version: "1.0.0",
      rightsClassification: "permitted",
    });
    assert.equal(report.license, "unknown");
    assert.equal(report.imported.length, 2);
    const found = await searchAssets(fx.db, { query: "arrow", licenses: ["unknown"] });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.serving, "metadata-only");
  } finally {
    await teardown(fx);
  }
});
