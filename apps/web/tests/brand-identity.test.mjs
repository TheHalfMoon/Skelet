import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertSafeSvgBody } from "../../../packages/assets/src/iconset.ts";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const tokens = JSON.parse(read("../../../docs/brand/tokens.json"));
const icons = JSON.parse(read("../registry/skilit-ui-icons.json"));
const paths = [
  "../public/brand/skilit-mark-orange.svg",
  "../public/brand/skilit-mark-black.svg",
  "../public/brand/skilit-lockup-light.svg",
  "../public/brand/skilit-lockup-orange.svg",
  "../app/icon.svg",
];
const assets = paths.map(read);

test("Skilit is the sole first-party brand identity in the active assets", () => {
  assert.equal(tokens.product, "skilit");
  assert.equal(tokens.version, 2);
  for (const asset of assets) {
    assert.match(asset, /<svg\b/);
    assert.match(asset, /Skilit/i);
    assert.doesNotMatch(asset, /skelet|muse|claude|mistral/i);
    assert.doesNotMatch(asset, /<script|onload=|<foreignObject/i);
    assert.doesNotMatch(asset, /filter=|<filter|<linearGradient|<radialGradient/i);
  }
});

test("orange and black official marks have identical S geometry", () => {
  const marks = assets.slice(0, 2).map((asset) => asset.match(/<path d="([^"]+)"/)?.[1]);
  assert.ok(marks[0]?.startsWith("M "));
  assert.equal(marks[0], marks[1]);
  const lockups = assets.slice(2, 4).map((asset) => asset.match(/<path d="([^"]+)"/)?.[1]);
  assert.deepEqual(lockups, marks);
  assert.ok(assets[2].includes(tokens.colors.orange));
  assert.ok(assets[3].includes(tokens.colors.orangeField));
  assert.ok(assets[3].includes(tokens.colors.ink));
  for (const lockup of assets.slice(2, 4)) {
    assert.match(lockup, /<text[^>]+>skilit<\/text>/, "approved wordmark must stay lowercase");
    assert.doesNotMatch(lockup, />Skilit<\/text>/);
  }
  assert.match(assets[4], /fill="#FAF8F5"/);
  assert.match(assets[4], /fill="#FF6A1F"/);
});

test("18 Skilit-owned icons are safe and compatible with the asset importer", () => {
  assert.equal(icons.prefix, "skilit");
  assert.equal(Object.keys(icons.icons).length, 18);
  for (const [name, icon] of Object.entries(icons.icons)) {
    assert.match(name, /^[a-z][a-z0-9-]+$/);
    assert.ok(icon.paths.length > 0, name);
    assertSafeSvgBody(icon.body, name);
    for (const path of icon.paths) {
      assert.ok(icon.body.includes(path), name);
    }
  }
});

test("brand tokens and runtime stylesheet have no palette drift", () => {
  const css = read("../app/globals.css").toUpperCase();
  for (const [key, hex] of Object.entries(tokens.colors)) {
    assert.ok(css.includes(hex.toUpperCase()), key);
  }
});

test("navigation includes each existing Skilit workflow", () => {
  const navigation = read("../components/skilit-shell.tsx");
  const home = read("../app/page.tsx");
  for (const route of ["/lens", "/gallery", "/patterns", "/boards", "/flows"]) {
    assert.ok(navigation.includes(route), route);
    assert.ok(home.includes(route), route);
  }
  assert.match(navigation, /aria-current=/);
  assert.match(home, /href="\/api\/health"/);
});
