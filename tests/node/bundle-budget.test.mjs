import assert from "node:assert/strict";
import test from "node:test";

import {
  ROUTE_BUDGET_KB,
  SHARED_BUDGET_KB,
  checkBudgets,
  parseBuildOutput,
} from "../../scripts/check_bundle_budget.mjs";

const FROZEN_SAMPLE = [
  "Route (app)                                    Size  First Load JS",
  "┌ ○ /                                       3.45 kB         106 kB",
  "├ ○ /_not-found                               993 B         104 kB",
  "├ ƒ /api/health                               200 B         103 kB",
  "├ ○ /flows                                  2.81 kB         105 kB",
  "├ ○ /gallery                                2.01 kB         105 kB",
  "├ ○ /lens                                   3.59 kB         106 kB",
  "└ ○ /patterns                               2.06 kB         105 kB",
  "+ First Load JS shared by all                103 kB",
  "  ├ chunks/812-52aaa9f8a3640ba4.js          46.6 kB",
  "  ├ chunks/9923a0e2-1a45aa5d099bff40.js     54.2 kB",
  "  └ other shared chunks (total)             1.87 kB",
].join("\n");

test("AC-00: frozen build sample parses to measured sizes", () => {
  const parsed = parseBuildOutput(FROZEN_SAMPLE);
  assert.equal(parsed.sharedKb, 103);
  assert.equal(parsed.routes.length, 7);
  const byRoute = new Map(parsed.routes.map((entry) => [entry.route, entry.firstLoadKb]));
  assert.equal(byRoute.get("/"), 106);
  assert.equal(byRoute.get("/flows"), 105);
  assert.equal(byRoute.get("/api/health"), 103);
  assert.equal(SHARED_BUDGET_KB, 120);
  assert.equal(ROUTE_BUDGET_KB, 140);
});

test("AC-00: budgets pass on the measured baseline", () => {
  const verdict = checkBudgets(parseBuildOutput(FROZEN_SAMPLE));
  assert.equal(verdict.ok, true);
  assert.equal(verdict.sharedKb, 103);
  assert.equal(verdict.maxRouteKb, 106);
  assert.equal(verdict.maxRoute, "/");
  assert.deepEqual(verdict.breaches, []);
});

test("AC-00: breaches fail with named routes", () => {
  const over = checkBudgets({ sharedKb: 103, routes: [{ route: "/lens", firstLoadKb: 141 }] });
  assert.equal(over.ok, false);
  assert.equal(over.breaches.length, 1);
  assert.ok(over.breaches[0].includes("/lens"));
  const shared = checkBudgets({ sharedKb: 121, routes: [{ route: "/", firstLoadKb: 106 }] });
  assert.equal(shared.ok, false);
  assert.ok(shared.breaches[0].includes("shared"));
});

test("AC-00: unparseable output fails closed", () => {
  for (const bad of ["", "no table here", "First Load JS shared by all\n"]) {
    assert.throws(() => parseBuildOutput(bad), Error);
  }
});
