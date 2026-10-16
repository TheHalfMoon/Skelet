import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layout = readFileSync(new URL("../../apps/web/app/layout.tsx", import.meta.url), "utf8");
test("root layout exposes consistent semantic navigation to qualified local views", () => {
  assert.match(layout, /aria-label="Skelet primary navigation"/);
  for (const route of ["/", "/gallery", "/flows", "/patterns", "/boards", "/lens"]) {
    assert.ok(layout.includes(`href="${route}"`), `navigation missing ${route}`);
  }
  assert.match(layout, /flexWrap: "wrap"/);
});
