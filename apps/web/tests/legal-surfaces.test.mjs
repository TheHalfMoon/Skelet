import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const PAGES = {
  privacy: new URL("../app/privacy/page.tsx", import.meta.url),
  terms: new URL("../app/terms/page.tsx", import.meta.url),
  support: new URL("../app/support/page.tsx", import.meta.url),
};

async function source(name) {
  return readFile(PAGES[name], "utf8");
}

test("legal surfaces state the local-first posture without new claims", async () => {
  const privacy = await source("privacy");
  for (const marker of ["Privacy", "local-first", "masked before storage", "never", "workspace"]) {
    assert.ok(privacy.includes(marker), `privacy page exposes ${marker}`);
  }
  const terms = await source("terms");
  for (const marker of ["Terms", "UPSTREAMS.lock.yml", "Acceptable use", "nothing here invents them"]) {
    assert.ok(terms.includes(marker), `terms page exposes ${marker}`);
  }
  const support = await source("support");
  for (const marker of ["Support", "self-hosted", "RUNBOOK.md", "Boundaries"]) {
    assert.ok(support.includes(marker), `support page exposes ${marker}`);
  }
});

test("legal surfaces are static with no data fetching or secrets", async () => {
  for (const name of Object.keys(PAGES)) {
    const text = await source(name);
    assert.ok(text.includes("<main"), `${name} renders a main landmark`);
    assert.ok(text.includes("<h1>"), `${name} has a top-level heading`);
    for (const forbidden of ["fetch(", "useState", "useEffect", "process.env", "Bearer ", "lorem", "TODO", "Math.random()"]) {
      assert.ok(!text.includes(forbidden), `${name} must not contain ${JSON.stringify(forbidden)}`);
    }
    assert.ok(!/Bearer [A-Za-z0-9._-]{8,}/.test(text), `${name} carries no hardcoded credential`);
  }
});

test("legal surfaces cross-link and are reachable from home", async () => {
  const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const route of ['href="/privacy"', 'href="/terms"', 'href="/support"']) {
    assert.ok(home.includes(route), `home links to ${route}`);
  }
  assert.ok((await source("privacy")).includes('href="/terms"'), "privacy links to terms");
  assert.ok((await source("terms")).includes('href="/support"'), "terms links to support");
  assert.ok((await source("support")).includes('href="/privacy"'), "support links to privacy");
});
