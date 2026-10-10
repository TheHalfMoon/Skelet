import { createHash } from "node:crypto";
import { validateCaptureUrl } from "./url-guard.ts";

/**
 * G09b-03 bounded multi-page capture scope resolution.
 *
 * Pure and deterministic: given a Build Kit scope request, produce an
 * ordered capture inventory plus explicit coverage gaps. No network, no
 * browser, no traversal here; the traversal/execution grain consumes
 * this inventory and enforces the recorded budgets.
 *
 * Safety: every URL passes the shared SSRF shape policy
 * (validateCaptureUrl) and must be https; multi-page modes additionally
 * require exact-host same-site with the source URL. Rejected and
 * over-budget candidates are preserved as coverage gaps, never
 * silently dropped. Unknown request fields fail closed.
 */

/** Frozen G09b-01 scope bounds, mirrored from the manifest contract. */
export const SCOPE_BOUNDS = {
  maxPages: { min: 1, max: 25 },
  maxDepth: { min: 0, max: 3 },
  maxBytes: { min: 1, max: 52428800 },
  timeBudgetMs: { min: 1000, max: 600000 },
} as const;

export type CaptureScopeMode = "single-page" | "selected-pages" | "bounded-sitemap";
export type CaptureViewport = "desktop" | "mobile";

export interface CaptureScopeRequest {
  sourceUrl: string;
  mode: CaptureScopeMode;
  pages?: string[];
  maxPages: number;
  maxDepth: number;
  maxBytes: number;
  timeBudgetMs: number;
  viewports?: CaptureViewport[];
}

export interface ScopedPage {
  index: number;
  url: string;
  urlSha256: string;
  hostname: string;
  viewports: CaptureViewport[];
  budgetBytes: number;
  budgetMs: number;
}

export type CoverageGapReason =
  | "rejected-url"
  | "cross-site"
  | "duplicate"
  | "over-budget";

export interface CoverageGap {
  reason: CoverageGapReason;
  url: string;
  detail: string;
}

export interface CaptureScopeInventory {
  scopeHash: string;
  mode: CaptureScopeMode;
  sourceHostname: string;
  budgets: {
    maxPages: number;
    maxDepth: number;
    maxBytes: number;
    timeBudgetMs: number;
  };
  viewports: CaptureViewport[];
  pages: ScopedPage[];
  excluded: CoverageGap[];
}

export class CaptureScopeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CaptureScopeError";
    this.code = code;
  }
}

function invalid(message: string): CaptureScopeError {
  return new CaptureScopeError("scope/invalid-request", message);
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function validateInt(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw invalid(`${what} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function httpsHref(input: string, what: string): { href: string; hostname: string } {
  let validated: { href: string; hostname: string };
  try {
    validated = validateCaptureUrl(input);
  } catch {
    throw invalid(`${what} is not an authorized capture URL.`);
  }
  if (!validated.href.startsWith("https://")) {
    throw invalid(`${what} must be an https URL.`);
  }
  return validated;
}

const KNOWN_FIELDS = new Set([
  "sourceUrl",
  "mode",
  "pages",
  "maxPages",
  "maxDepth",
  "maxBytes",
  "timeBudgetMs",
  "viewports",
]);

/**
 * Resolve a capture scope into a deterministic inventory. The source
 * URL is always validated; per-mode page selection is validated,
 * same-site filtered, deduplicated, budget sliced, and hashed.
 */
export function resolveCaptureScope(input: CaptureScopeRequest): CaptureScopeInventory {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw invalid("Scope request must be an object.");
  }
  for (const key of Object.keys(input)) {
    if (!KNOWN_FIELDS.has(key)) throw invalid(`Unknown scope field: ${key}.`);
  }
  if (
    input.mode !== "single-page" &&
    input.mode !== "selected-pages" &&
    input.mode !== "bounded-sitemap"
  ) {
    throw invalid("Capture mode is invalid.");
  }
  const source = httpsHref(input.sourceUrl, "Source URL");
  const maxPages = validateInt(
    input.maxPages, "Max pages", SCOPE_BOUNDS.maxPages.min, SCOPE_BOUNDS.maxPages.max,
  );
  const maxDepth = validateInt(
    input.maxDepth, "Max depth", SCOPE_BOUNDS.maxDepth.min, SCOPE_BOUNDS.maxDepth.max,
  );
  const maxBytes = validateInt(
    input.maxBytes, "Max bytes", SCOPE_BOUNDS.maxBytes.min, SCOPE_BOUNDS.maxBytes.max,
  );
  const timeBudgetMs = validateInt(
    input.timeBudgetMs, "Time budget",
    SCOPE_BOUNDS.timeBudgetMs.min, SCOPE_BOUNDS.timeBudgetMs.max,
  );
  let viewports: CaptureViewport[];
  if (input.viewports === undefined) {
    viewports = ["desktop"];
  } else {
    if (!Array.isArray(input.viewports) || input.viewports.length === 0) {
      throw invalid("Viewports are invalid.");
    }
    const seen = new Set<CaptureViewport>();
    for (const viewport of input.viewports) {
      if (viewport !== "desktop" && viewport !== "mobile") {
        throw invalid("Viewports are invalid.");
      }
      seen.add(viewport);
    }
    viewports = [...seen].sort();
  }

  const excluded: CoverageGap[] = [];
  let hrefs: string[];
  if (input.mode === "single-page") {
    if (input.pages !== undefined && input.pages.length > 0) {
      const only = input.pages.length === 1 ? input.pages[0] : undefined;
      if (only === undefined || httpsHref(only, "Page URL").href !== source.href) {
        throw invalid("Single-page mode accepts only the source URL.");
      }
    }
    hrefs = [source.href];
  } else {
    if (!Array.isArray(input.pages) || input.pages.length === 0) {
      throw invalid(`${input.mode} mode needs at least one candidate page URL.`);
    }
    if (input.pages.length > 500) {
      throw invalid("Candidate page list is too large.");
    }
    const seen = new Set<string>();
    const accepted: string[] = [];
    // Deterministic order: request order for selected-pages,
    // lexicographic for bounded-sitemap candidates.
    const ordered = input.mode === "selected-pages"
      ? [...input.pages]
      : [...input.pages].sort();
    for (const candidate of ordered) {
      let validated: { href: string; hostname: string };
      try {
        validated = httpsHref(candidate, "Page URL");
      } catch {
        excluded.push({
          reason: "rejected-url",
          url: String(candidate).slice(0, 2048),
          detail: "Candidate failed capture URL policy.",
        });
        continue;
      }
      if (validated.hostname !== source.hostname) {
        excluded.push({
          reason: "cross-site",
          url: validated.href,
          detail: `Host ${validated.hostname} is outside the source site ${source.hostname}.`,
        });
        continue;
      }
      if (seen.has(validated.href)) {
        excluded.push({
          reason: "duplicate",
          url: validated.href,
          detail: "Candidate repeats an earlier page.",
        });
        continue;
      }
      seen.add(validated.href);
      accepted.push(validated.href);
    }
    if (accepted.length === 0) {
      throw invalid("No candidate page survived scope policy.");
    }
    hrefs = accepted.slice(0, maxPages);
    for (const dropped of accepted.slice(maxPages)) {
      excluded.push({
        reason: "over-budget",
        url: dropped,
        detail: `Candidate exceeds the ${maxPages}-page budget.`,
      });
    }
  }

  const count = hrefs.length;
  const pages: ScopedPage[] = hrefs.map((href, index) => ({
    index,
    url: href,
    urlSha256: sha256Hex(href),
    hostname: source.hostname,
    viewports: [...viewports],
    budgetBytes: Math.max(1, Math.floor(maxBytes / count)),
    budgetMs: Math.max(1, Math.floor(timeBudgetMs / count)),
  }));
  const scopeHash = sha256Hex(canonicalJson({
    mode: input.mode,
    pages: hrefs,
    viewports,
    budgets: { maxPages, maxDepth, maxBytes, timeBudgetMs },
  }));
  return {
    scopeHash,
    mode: input.mode,
    sourceHostname: source.hostname,
    budgets: { maxPages, maxDepth, maxBytes, timeBudgetMs },
    viewports,
    pages,
    excluded,
  };
}
