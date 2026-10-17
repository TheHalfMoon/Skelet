import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url));
const text = (relative) => read(relative).toString("utf8");

test("two Skilit social compositions preserve exactly the official S geometry", () => {
  const official = text("../public/brand/skilit-mark-orange.svg");
  const shape = official.match(/<path d="([^"]+)"/)?.[1];
  assert.ok(shape);
  for (const variant of ["light", "orange"]) {
    const social = text(`../public/brand/skilit-social-${variant}.svg`);
    assert.match(social, /viewBox="0 0 1200 630"/);
    assert.match(social, /<text[^>]+>skilit<\/text>/);
    assert.match(social, /DESIGN INTELLIGENCE/);
    assert.match(social, /For humans and AI agents/);
    assert.equal(social.match(/<path d="([^"]+)"/)?.[1], shape);
    assert.doesNotMatch(social, /<script|onload=|<foreignObject|<filter|<linearGradient|<radialGradient|href="https?:/i);
    assert.doesNotMatch(social, /skelet|claude|mistral|muse/i);
  }
});

test("social PNG assets are valid standard 1200x630 screenshots", () => {
  for (const variant of ["light", "orange"]) {
    const png = read(`../public/brand/skilit-social-${variant}.png`);
    assert.ok(png.length > 12000, "PNG is non-empty and has real visual content");
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
  }
});

test("Skilit branding is consistent across README, shell, local meta previews and auth", () => {
  const readme = text("../../../README.md");
  const shell = text("../components/skilit-shell.tsx");
  const metadata = text("../app/layout.tsx");
  assert.match(readme, /apps\/web\/public\/brand\/skilit-lockup-light.svg/);
  assert.match(readme, /docs\/brand\/IDENTITY.md/);
  assert.match(shell, /<span>skilit<\/span>/);
  assert.doesNotMatch(shell, /sk-brand-dot|<span>Skilit<\/span>/);
  assert.match(metadata, /SKILIT_METADATA_ORIGIN/);
  assert.match(metadata, /openGraph:/);
  assert.match(metadata, /twitter:/);
  assert.match(metadata, /summary_large_image/);
  assert.match(metadata, /skilit-social-light.png/);
  for (const page of ["login", "signup"]) {
    const auth = text(`../app/${page}/page.tsx`);
    assert.match(auth, /className="sk-auth-page"/);
    assert.match(auth, /skilit-mark-orange.svg/);
    assert.match(auth, /sk-auth-identity/);
  }
});

test("approved S geometry is retained across lowercase lockups", () => {
  const tokens = JSON.parse(text("../../../docs/brand/tokens.json"));
  const light = text("../public/brand/skilit-lockup-light.svg");
  const dark = text("../public/brand/skilit-lockup-orange.svg");
  assert.ok(light.includes(tokens.colors.orange));
  assert.ok(dark.includes(tokens.colors.orangeField));
  assert.ok(dark.includes(tokens.colors.ink));
});
