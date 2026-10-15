import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../db/src/db.ts";
import { migrateUp } from "../../db/src/migrate.ts";
import { createSource } from "../../db/src/repositories.ts";
import { createArtifact, createPattern, createRelation } from "../../db/src/graph.ts";
import { signUp } from "../../db/src/auth.ts";
import { createWorkspace } from "../../db/src/workspaces.ts";
import {
  PatternError,
  getPatternForActor,
  listPatternsForActor,
  validatePatternTaxonomy,
} from "../src/patterns.ts";

const HEX = (char) => char.repeat(64);

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "pattern-owner@skelet.example", password: "pattern-password-01" });
  const outsider = await signUp(db, { email: "pattern-out@skelet.example", password: "pattern-password-01" });
  const source = await createSource(db, { key: "pattern-source", kind: "synthetic" });
  return { db, owner, outsider, source };
}

async function artifact(db, sourceId, overrides = {}) {
  return createArtifact(db, {
    sourceId,
    kind: "screen",
    title: "Pattern screen",
    contentHash: HEX("a"),
    rightsClassification: "permitted",
    visibility: "public",
    ...overrides,
  });
}

async function pattern(db, sourceId, overrides = {}) {
  return createPattern(db, {
    slug: "global-navigation",
    title: "Global navigation",
    sourceId,
    ...overrides,
  });
}

test("P10-C: taxonomy validation accepts canonical identities and rejects the rest", async () => {
  assert.deepEqual(
    validatePatternTaxonomy({ slug: "card-grid-2", title: "Card grid" }),
    { slug: "card-grid-2", title: "Card grid", description: undefined },
  );
  for (const bad of [
    null,
    "slug",
    { slug: "Uppercase", title: "T" },
    { slug: "-leading", title: "T" },
    { slug: "a".repeat(65), title: "T" },
    { slug: "ok", title: "" },
    { slug: "ok", title: "t".repeat(129) },
    { slug: "ok", title: "T", description: "d".repeat(2001) },
  ]) {
    assert.throws(() => validatePatternTaxonomy(bad), (error) => error instanceof PatternError, JSON.stringify(bad));
  }
});

test("P10-C: patterns list with readable counts in deterministic slug order", async () => {
  const fx = await fixture();
  try {
    const beta = await pattern(fx.db, fx.source.id, { slug: "beta-pattern", title: "Beta pattern" });
    const alpha = await pattern(fx.db, fx.source.id, { slug: "alpha-pattern", title: "Alpha pattern" });
    const betaArt = await artifact(fx.db, fx.source.id, { title: "Beta screen" });
    const alphaArt = await artifact(fx.db, fx.source.id, { title: "Alpha screen" });
    await createRelation(fx.db, { fromType: "pattern", fromId: beta.id, relationType: "appears_in", toType: "artifact", toId: betaArt.id });
    await createRelation(fx.db, { fromType: "artifact", fromId: alphaArt.id, relationType: "references", toType: "pattern", toId: alpha.id });
    const outcome = await listPatternsForActor(fx.db, { actorId: fx.owner.id });
    assert.equal(outcome.total, 2);
    assert.deepEqual(outcome.patterns.map((entry) => entry.slug), ["alpha-pattern", "beta-pattern"]);
    assert.ok(outcome.patterns.every((entry) => entry.artifactCount === 1));
    assert.deepEqual(await listPatternsForActor(fx.db, { actorId: fx.owner.id }), outcome);
  } finally {
    await fx.db.close();
  }
});

test("P10-C: unlinked and fully-withheld patterns stay invisible with no oracle", async () => {
  const fx = await fixture();
  try {
    await pattern(fx.db, fx.source.id, { slug: "lonely-pattern", title: "Lonely" });
    const space = await createWorkspace(fx.db, { name: "Pattern vault", ownerId: fx.owner.id });
    const hiddenArt = await artifact(fx.db, fx.source.id, {
      title: "Vault screen",
      visibility: "private",
      workspaceId: space.workspace.id,
      ownerSubject: fx.owner.id,
    });
    const hidden = await pattern(fx.db, fx.source.id, { slug: "vault-pattern", title: "Vault" });
    await createRelation(fx.db, { fromType: "pattern", fromId: hidden.id, relationType: "appears_in", toType: "artifact", toId: hiddenArt.id });
    const ownerView = await listPatternsForActor(fx.db, { actorId: fx.owner.id });
    assert.equal(ownerView.total, 1);
    assert.equal(ownerView.patterns[0].slug, "vault-pattern");
    const outsiderView = await listPatternsForActor(fx.db, { actorId: fx.outsider.id });
    assert.equal(outsiderView.total, 0);
    assert.deepEqual(outsiderView.patterns, []);
    assert.equal(await getPatternForActor(fx.db, { actorId: fx.outsider.id, slug: "vault-pattern" }), null);
    assert.equal(await getPatternForActor(fx.db, { actorId: fx.owner.id, slug: "no-such-pattern" }), null);
  } finally {
    await fx.db.close();
  }
});

test("P10-C: pattern detail carries links, relations, and deterministic order", async () => {
  const fx = await fixture();
  try {
    const entry = await pattern(fx.db, fx.source.id, { slug: "detail-pattern", title: "Detail", description: "A pattern" });
    const first = await artifact(fx.db, fx.source.id, { title: "First screen" });
    const second = await artifact(fx.db, fx.source.id, { title: "Second screen" });
    await createRelation(fx.db, { fromType: "pattern", fromId: entry.id, relationType: "references", toType: "artifact", toId: second.id });
    await createRelation(fx.db, { fromType: "artifact", fromId: first.id, relationType: "appears_in", toType: "pattern", toId: entry.id });
    const detail = await getPatternForActor(fx.db, { actorId: fx.owner.id, slug: "detail-pattern" });
    assert.ok(detail !== null);
    assert.equal(detail.title, "Detail");
    assert.equal(detail.description, "A pattern");
    assert.equal(detail.links.length, 2);
    assert.ok(detail.links.every((link) => link.uri.startsWith("skelet://artifact/")));
    assert.deepEqual(detail.links.map((link) => link.relation).sort(), ["appears_in", "references"]);
  } finally {
    await fx.db.close();
  }
});

test("P10-C: query filters and pagination stay deterministic", async () => {
  const fx = await fixture();
  try {
    for (const slug of ["nav-bar", "nav-drawer", "card-grid"]) {
      const entry = await pattern(fx.db, fx.source.id, { slug, title: `Title ${slug}` });
      const art = await artifact(fx.db, fx.source.id, { title: `${slug} screen` });
      await createRelation(fx.db, { fromType: "pattern", fromId: entry.id, relationType: "appears_in", toType: "artifact", toId: art.id });
    }
    const filtered = await listPatternsForActor(fx.db, { actorId: fx.owner.id, query: "NAV" });
    assert.equal(filtered.total, 2);
    assert.deepEqual(filtered.patterns.map((entry) => entry.slug), ["nav-bar", "nav-drawer"]);
    const page = await listPatternsForActor(fx.db, { actorId: fx.owner.id, limit: 2 });
    assert.equal(page.patterns.length, 2);
    assert.equal(page.total, 3);
    const rest = await listPatternsForActor(fx.db, { actorId: fx.owner.id, limit: 2, offset: 2 });
    assert.equal(rest.patterns.length, 1);
  } finally {
    await fx.db.close();
  }
});

test("P10-C: malformed slugs, actors, and limits fail invalid-input", async () => {
  const fx = await fixture();
  try {
    const entry = await pattern(fx.db, fx.source.id, { slug: "strict-pattern", title: "Strict" });
    const art = await artifact(fx.db, fx.source.id, { title: "Strict screen" });
    await createRelation(fx.db, { fromType: "pattern", fromId: entry.id, relationType: "appears_in", toType: "artifact", toId: art.id });
    for (const input of [
      { actorId: "", slug: "strict-pattern" },
      { actorId: fx.owner.id, slug: "Uppercase" },
      { actorId: fx.owner.id, slug: "" },
    ]) {
      await assert.rejects(getPatternForActor(fx.db, input), (error) => error instanceof PatternError);
    }
    for (const input of [
      { actorId: "", limit: 1 },
      { actorId: fx.owner.id, limit: 0 },
      { actorId: fx.owner.id, limit: 51 },
      { actorId: fx.owner.id, query: "" },
    ]) {
      await assert.rejects(listPatternsForActor(fx.db, input), (error) => error instanceof PatternError);
    }
  } finally {
    await fx.db.close();
  }
});
