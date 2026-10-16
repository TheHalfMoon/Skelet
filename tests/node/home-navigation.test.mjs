import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../apps/web/app/page.tsx", import.meta.url), "utf8");

test("home has navigable links to the five qualified local views", () => {
  for (const href of ["/gallery", "/flows", "/patterns", "/boards", "/lens"]) {
    assert.ok(source.includes(`href: "${href}"`), `missing ${href}`);
  }
  assert.match(source, /className="sk-tools-grid"/);
  const shell = readFileSync(new URL("../../apps/web/components/skilit-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /aria-label="Skilit primary navigation"/);
  for (const href of ["/gallery", "/flows", "/patterns", "/boards", "/lens"]) {
    assert.ok(shell.includes(`href: "${href}"`), `navigation missing ${href}`);
  }
  assert.match(source, /aria-label="Documentation and service links"/);
});

test("home does not advertise unimplemented browser sign-in", () => {
  assert.match(source, /browser sign-in screen is not yet provided/);
  assert.match(source, /operator-provisioned/);
});

test("home includes health, registry, and informational routes", () => {
  for (const href of ["/api/health", "/api/registry", "/privacy", "/terms", "/support"]) {
    assert.ok(source.includes(`href="${href}"`));
  }
});
