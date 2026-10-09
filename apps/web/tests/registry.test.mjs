import assert from "node:assert/strict";
import test from "node:test";

import {
  RegistryError,
  buildRegistryIndex,
  buildRegistryItem,
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
});
