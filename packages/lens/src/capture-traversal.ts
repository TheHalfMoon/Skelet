import type { CaptureScopeInventory } from "./capture-scope.ts";

/**
 * G09b-04 bounded traversal/capture execution.
 *
 * Consumes a resolved {@link CaptureScopeInventory} (G09b-03) and fetches
 * each scoped page in inventory order through an injected page-fetch
 * function. No network, browser, or storage here; production wiring
 * supplies `fetchGuardedHtml`-backed fetching in a later grain, while
 * tests supply a fully offline stub.
 *
 * Budgeting: every page attempt honors its per-page `budgetBytes` /
 * `budgetMs` slice. The injected fetch function is responsible for
 * honoring its per-page slice (production `fetchGuardedHtml` enforces
 * its byte budget); traversal enforces the inventory totals
 * `maxBytes` / `timeBudgetMs` across the run: once cumulative bytes
 * or elapsed milliseconds reach the total, remaining pages are
 * recorded as `skipped` with a typed code instead of being attempted
 * or silently dropped. A single over-slice capture is still recorded
 * honestly; the totals gate then skips the rest.
 *
 * Outcome: `completed` when every page captured, `partial` when at
 * least one page captured but coverage is incomplete, `failed` when
 * nothing was captured. Missing and skipped pages are always
 * reported; the result never fabricates page content.
 */

export type TraversalFailureCode =
  | "capture/blocked"
  | "capture/timeout"
  | "capture/too-large"
  | "capture/unsupported"
  | "capture/network"
  | "capture/browser"
  | "capture/skipped";

const KNOWN_CODES: ReadonlySet<string> = new Set([
  "capture/blocked",
  "capture/timeout",
  "capture/too-large",
  "capture/unsupported",
  "capture/network",
  "capture/browser",
]);

const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface FetchedPage {
  htmlSha256: string;
  byteCount: number;
  redirects: number;
}

export interface TraversalPageFetch {
  (url: string, budgetBytes: number, budgetMs: number): Promise<FetchedPage>;
}

export type TraversedPageStatus = "captured" | "failed" | "skipped";

export interface TraversedPage {
  index: number;
  url: string;
  urlSha256: string;
  status: TraversedPageStatus;
  htmlSha256?: string;
  byteCount?: number;
  redirects?: number;
  code?: TraversalFailureCode;
  detail?: string;
}

export type TraversalOutcome = "completed" | "partial" | "failed";

export interface CaptureTraversalResult {
  scopeHash: string;
  outcome: TraversalOutcome;
  attempted: number;
  captured: number;
  failed: number;
  skipped: number;
  bytesTotal: number;
  elapsedMs: number;
  pages: TraversedPage[];
}

export class CaptureTraversalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CaptureTraversalError";
    this.code = code;
  }
}

function invalid(message: string): CaptureTraversalError {
  return new CaptureTraversalError("traversal/invalid-inventory", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateInventory(input: unknown): CaptureScopeInventory {
  if (!isRecord(input)) throw invalid("Traversal inventory must be an object.");
  if (typeof input.scopeHash !== "string" || !SHA256_HEX.test(input.scopeHash)) {
    throw invalid("Traversal inventory has an invalid scope hash.");
  }
  if (!isRecord(input.budgets)) throw invalid("Traversal inventory has invalid budgets.");
  const { maxPages, maxDepth, maxBytes, timeBudgetMs } = input.budgets as Record<string, unknown>;
  // maxDepth 0 is a legal single-layer scope; every other budget needs >= 1.
  if (typeof maxDepth !== "number" || !Number.isInteger(maxDepth) || maxDepth < 0) {
    throw invalid("Traversal inventory budget maxDepth is invalid.");
  }
  for (const [name, value] of [["maxPages", maxPages], ["maxBytes", maxBytes], ["timeBudgetMs", timeBudgetMs]] as const) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw invalid(`Traversal inventory budget ${name} is invalid.`);
    }
  }
  if (!Array.isArray(input.pages) || input.pages.length === 0 || input.pages.length > 25) {
    throw invalid("Traversal inventory must list 1 to 25 pages.");
  }
  input.pages.forEach((page, position) => {
    if (!isRecord(page)) throw invalid(`Traversal page ${position} is invalid.`);
    if (typeof page.url !== "string" || page.url.length === 0) {
      throw invalid(`Traversal page ${position} has an invalid URL.`);
    }
    if (typeof page.urlSha256 !== "string" || !SHA256_HEX.test(page.urlSha256)) {
      throw invalid(`Traversal page ${position} has an invalid URL hash.`);
    }
    if (typeof page.index !== "number" || !Number.isInteger(page.index)) {
      throw invalid(`Traversal page ${position} has an invalid index.`);
    }
    if (typeof page.budgetBytes !== "number" || !Number.isInteger(page.budgetBytes) || page.budgetBytes < 1) {
      throw invalid(`Traversal page ${position} has an invalid byte budget.`);
    }
    if (typeof page.budgetMs !== "number" || !Number.isInteger(page.budgetMs) || page.budgetMs < 1) {
      throw invalid(`Traversal page ${position} has an invalid time budget.`);
    }
  });
  return input as unknown as CaptureScopeInventory;
}

function failureOf(error: unknown): { code: TraversalFailureCode; detail: string } {
  if (isRecord(error) && typeof error.code === "string" && KNOWN_CODES.has(error.code)) {
    const detail = typeof error.message === "string" && error.message.length > 0
      ? error.message.slice(0, 500)
      : "Page fetch failed with a typed capture error.";
    return { code: error.code as TraversalFailureCode, detail };
  }
  return { code: "capture/network", detail: "Page fetch failed without a typed code." };
}

/**
 * Execute a resolved capture scope page by page, in inventory order.
 * Sequential and deterministic: no concurrent attempts, no retries,
 * no content synthesis. Budget exhaustion records the remaining
 * pages as skipped; fetch failures record the page as failed and the
 * run continues with the next page.
 */
export async function executeCaptureScope(
  inventory: CaptureScopeInventory,
  fetchPage: TraversalPageFetch,
  now: () => number = Date.now,
): Promise<CaptureTraversalResult> {
  const scope = validateInventory(inventory);
  if (typeof fetchPage !== "function") throw invalid("Traversal requires a page-fetch function.");
  const started = now();
  const pages: TraversedPage[] = [];
  let attempted = 0;
  let captured = 0;
  let failed = 0;
  let skipped = 0;
  let bytesTotal = 0;

  for (const page of scope.pages) {
    const elapsed = now() - started;
    const budgetsExhausted =
      bytesTotal >= scope.budgets.maxBytes || elapsed >= scope.budgets.timeBudgetMs;
    if (budgetsExhausted) {
      skipped += 1;
      pages.push({
        index: page.index,
        url: page.url,
        urlSha256: page.urlSha256,
        status: "skipped",
        code: "capture/skipped",
        detail: "Page not attempted: scope byte or time budget exhausted.",
      });
      continue;
    }
    attempted += 1;
    let fetched: FetchedPage;
    try {
      fetched = await fetchPage(page.url, page.budgetBytes, page.budgetMs);
    } catch (error) {
      failed += 1;
      const failure = failureOf(error);
      pages.push({
        index: page.index,
        url: page.url,
        urlSha256: page.urlSha256,
        status: "failed",
        code: failure.code,
        detail: failure.detail,
      });
      continue;
    }
    if (
      !isRecord(fetched) ||
      typeof fetched.htmlSha256 !== "string" ||
      !SHA256_HEX.test(fetched.htmlSha256) ||
      typeof fetched.byteCount !== "number" ||
      !Number.isInteger(fetched.byteCount) ||
      fetched.byteCount < 0 ||
      typeof fetched.redirects !== "number" ||
      !Number.isInteger(fetched.redirects) ||
      fetched.redirects < 0
    ) {
      failed += 1;
      pages.push({
        index: page.index,
        url: page.url,
        urlSha256: page.urlSha256,
        status: "failed",
        code: "capture/network",
        detail: "Page fetch returned a malformed capture record.",
      });
      continue;
    }
    captured += 1;
    bytesTotal += fetched.byteCount;
    pages.push({
      index: page.index,
      url: page.url,
      urlSha256: page.urlSha256,
      status: "captured",
      htmlSha256: fetched.htmlSha256,
      byteCount: fetched.byteCount,
      redirects: fetched.redirects,
    });
  }

  let outcome: TraversalOutcome;
  if (captured === scope.pages.length) {
    outcome = "completed";
  } else if (captured > 0) {
    outcome = "partial";
  } else {
    outcome = "failed";
  }
  return {
    scopeHash: scope.scopeHash,
    outcome,
    attempted,
    captured,
    failed,
    skipped,
    bytesTotal,
    elapsedMs: Math.max(0, now() - started),
    pages,
  };
}
