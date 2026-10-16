/**
 * AC-00 bundle baseline check (Skilit-owned, no-prod-dependency).
 *
 * Enforces the measured client-bundle rollback criterion for Issue #62
 * global gate 4: the Next.js production build must stay within the
 * recorded First Load JS budgets. Reads a production build output
 * (stdout of `pnpm --dir apps/web build`) from a file or stdin, parses
 * the route table, and fails closed on breach or unparseable output.
 *
 * Usage:
 *   pnpm --dir apps/web build 2>&1 | tee /tmp/build.log
 *   node scripts/check_bundle_budget.mjs --build-output /tmp/build.log
 *   cat /tmp/build.log | node scripts/check_bundle_budget.mjs --build-output -
 *
 * Budgets (kB, First Load JS):
 *   shared-by-all <= 120, max route <= 140.
 * Measured 2026-10-16 on the Mac release candidate: shared 103 kB,
 * heaviest route 106 kB (`/`). Budgets carry headroom for CI variance,
 * not a growth allowance: any breach must be justified or fixed.
 *
 * Exit codes: 0 within budget, 1 over budget, 2 invalid input.
 * No network, no model, no hosted service.
 */

import { readFile } from "node:fs/promises";

export const SHARED_BUDGET_KB = 120;
export const ROUTE_BUDGET_KB = 140;

function fail(message) {
  process.stderr.write(`check_bundle_budget: ${message}\n`);
  process.exit(2);
}

function parseSize(text) {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(B|kB|MB)\s*$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(value) || value < 0) return null;
  if (unit === "B") return value / 1024;
  if (unit === "kB") return value;
  return value * 1024;
}

/**
 * Parse a Next.js route-table build output into shared and per-route
 * First Load JS kilobytes. Returns { sharedKb, routes: [{ route, sizeKb, firstLoadKb }] }.
 * Throws on unparseable input (fail-closed: no silent pass).
 */
export function parseBuildOutput(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > 4 * 1024 * 1024) {
    throw new Error("Build output is invalid.");
  }
  const sharedMatch = /First Load JS shared by all\s+([0-9]+(?:\.[0-9]+)?\s*(?:B|kB|MB))/.exec(text);
  if (!sharedMatch) {
    throw new Error("Shared First Load JS line is missing.");
  }
  const sharedKb = parseSize(sharedMatch[1]);
  if (sharedKb === null) {
    throw new Error("Shared First Load JS size is invalid.");
  }
  const routes = [];
  const rowPattern = /^[├└┌│]\s*[○ƒλ]\s*(\S+)\s+(\S+(?:\s*[BMk]+)?)\s+(\S+(?:\s*[BMk]+)?)?\s*$/gm;
  // Row shapes: `├ ○ / 3.45 kB 106 kB` (size split across two tokens).
  const linePattern = /^[├└┌│]\s*[○ƒλ]\s*(\S+)\s+(.+?)\s+([0-9]+(?:\.[0-9]+)?\s*(?:B|kB|MB))\s*$/gm;
  let match;
  let found = false;
  while ((match = linePattern.exec(text)) !== null) {
    found = true;
    const firstLoadKb = parseSize(match[3]);
    if (firstLoadKb === null) {
      throw new Error(`First Load JS size is invalid for route ${match[1]}.`);
    }
    routes.push({ route: match[1], firstLoadKb });
  }
  void rowPattern;
  if (!found) {
    throw new Error("No route rows were parsed.");
  }
  return { sharedKb, routes };
}

/** Enforce budgets. Returns { ok, sharedKb, maxRouteKb, breaches }. */
export function checkBudgets(parsed) {
  const breaches = [];
  if (!(parsed.sharedKb <= SHARED_BUDGET_KB)) {
    breaches.push(`shared First Load JS ${parsed.sharedKb.toFixed(2)} kB exceeds ${SHARED_BUDGET_KB} kB`);
  }
  let maxRouteKb = 0;
  let maxRoute = "";
  for (const entry of parsed.routes) {
    if (entry.firstLoadKb > maxRouteKb) {
      maxRouteKb = entry.firstLoadKb;
      maxRoute = entry.route;
    }
  }
  if (!(maxRouteKb <= ROUTE_BUDGET_KB)) {
    breaches.push(`route ${maxRoute} First Load JS ${maxRouteKb.toFixed(2)} kB exceeds ${ROUTE_BUDGET_KB} kB`);
  }
  return { ok: breaches.length === 0, sharedKb: parsed.sharedKb, maxRouteKb, maxRoute, breaches };
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith("check_bundle_budget.mjs");
if (isMain) {
  const source = argValue("--build-output");
  if (source === undefined || source === "") {
    fail("the --build-output file (or - for stdin) is required.");
  }
  let text;
  try {
    if (source === "-") {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      text = Buffer.concat(chunks).toString("utf8");
    } else {
      const data = await readFile(source);
      if (data.length === 0 || data.length > 4 * 1024 * 1024) {
        fail("build output exceeds its byte budget.");
      }
      text = data.toString("utf8");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Build output")) fail(error.message);
    fail("build output cannot be read.");
  }
  let parsed;
  try {
    parsed = parseBuildOutput(text);
  } catch (error) {
    fail(error instanceof Error ? error.message : "build output is invalid.");
  }
  const verdict = checkBudgets(parsed);
  process.stdout.write(`${JSON.stringify({ ...verdict, sharedBudgetKb: SHARED_BUDGET_KB, routeBudgetKb: ROUTE_BUDGET_KB, routeCount: parsed.routes.length }, null, 2)}\n`);
  process.exit(verdict.ok ? 0 : 1);
}
