import assert from "node:assert/strict";
import test from "node:test";

import {
  RegistryError,
  buildRegistryIndex,
  buildRegistryItem,
  searchRegistryIndex,
} from "../lib/registry.ts";

test("registry index lists every item with provenance", () => {
  const index = buildRegistryIndex();
  assert.equal(index.name, "skelet-registry");
  assert.ok(index.version.length > 0);
  assert.deepEqual(
    index.items.map((entry) => entry.name).sort(),
    ["skelet-button", "skelet-card"],
  );
  for (const entry of index.items) {
    assert.ok(entry.title.length > 0);
    assert.ok(entry.description.length > 0);
  }
});

test("registry items satisfy the shadcn contract", () => {
  for (const name of ["skelet-button", "skelet-card"]) {
    const item = buildRegistryItem(name);
    assert.equal(item.name, name);
    assert.equal(item.type, "registry:ui");
    assert.ok(Array.isArray(item.dependencies));
    assert.ok(Array.isArray(item.devDependencies));
    assert.ok(Array.isArray(item.registryDependencies));
    assert.ok(item.files.length >= 1);
    for (const file of item.files) {
      assert.ok(file.path.endsWith(".tsx"));
      assert.ok(file.content.includes("Skelet"));
      assert.ok(file.content.length > 100);
    }
  }
  const button = buildRegistryItem("skelet-button");
  assert.ok(button.files[0]?.content.includes("evidenceUri"));
  const card = buildRegistryItem("skelet-card");
  assert.ok(card.files[0]?.content.includes("rightsNote"));
});

test("unknown registry items fail closed", () => {
  assert.throws(
    () => buildRegistryItem("no-such-widget"),
    (error) => error instanceof RegistryError && error.code === "registry/not-found",
  );
  assert.throws(
    () => buildRegistryItem("../registry"),
    (error) => error instanceof RegistryError && error.code === "registry/not-found",
  );
  assert.throws(
    () => buildRegistryItem("__proto__"),
    (error) => error instanceof RegistryError && error.code === "registry/not-found",
  );
  assert.throws(
    () => buildRegistryItem("constructor"),
    (error) => error instanceof RegistryError && error.code === "registry/not-found",
  );
});

test("registry search is deterministic across name, title, and description", () => {
  const all = searchRegistryIndex("", 20);
  assert.equal(all.total, 2);
  assert.deepEqual(
    all.items.map((entry) => entry.name),
    ["skelet-button", "skelet-card"],
  );
  const byName = searchRegistryIndex("  BUTTON ", 20);
  assert.equal(byName.total, 1);
  assert.equal(byName.items[0]?.name, "skelet-button");
  const byDescription = searchRegistryIndex("card", 20);
  assert.equal(byDescription.total, 1);
  assert.equal(byDescription.items[0]?.name, "skelet-card");
  const missing = searchRegistryIndex("no-such-widget", 20);
  assert.equal(missing.total, 0);
  assert.deepEqual(missing.items, []);
  const repeat = searchRegistryIndex("skelet", 20);
  assert.deepEqual(
    repeat.items.map((entry) => entry.name),
    ["skelet-button", "skelet-card"],
  );
});

test("registry search bounds limits without throwing", () => {
  const one = searchRegistryIndex("", 1);
  assert.equal(one.items.length, 1);
  assert.equal(one.total, 2);
  const clamped = searchRegistryIndex("", 99999);
  assert.equal(clamped.items.length, 2);
  assert.equal(clamped.total, 2);
  for (const fallback of [0, -3, Number.NaN]) {
    const outcome = searchRegistryIndex("", fallback);
    assert.equal(outcome.items.length, 2);
    assert.equal(outcome.total, 2);
  }
});
