/**
 * G09-11: deterministic, bounded, source-linked technology-signal evidence
 * for Skelet Lens.
 *
 * Pure, offline, dependency-free collection of OBSERVATIONS ONLY from an
 * already captured document. It never visits a URL, never fetches a script
 * or stylesheet body, never executes JavaScript, and never infers which
 * technology is installed. Classification and confidence-scored matching
 * belong to G09-12; a filename or metadata value here is an observed
 * string, never a verified technology identity.
 *
 * Approved evidence kinds (closed allowlist, no general crawler):
 *
 * - `meta-generator`   `meta[name=generator]` content (e.g. CMS banners).
 * - `script-src`       `script[src]` resolved absolute http(s) URL only.
 * - `stylesheet-href`  `link[rel~=stylesheet][href]` resolved http(s) URL.
 * - `resource-hint`    non-executable preload/prefetch/preconnect/
 *                      dns-prefetch/modulepreload/manifest hrefs.
 * - `dom-marker`       explicitly approved non-executable DOM markers:
 *                      `body[class]` class strings and `data-*` attribute
 *                      NAMES (never values) on `html`/`body`.
 *
 * Trust boundary: every value is attacker-influenced page DATA, not a
 * program instruction and not a technology fact. Values are clipped, never
 * executed; the report layer must escape them before rendering.
 */

import { elementRef } from "./style-evidence.ts";

/** Contract version carried by capture results and lens reports. */
export const TECH_SIGNAL_SCHEMA_VERSION = "skelet.lens.tech-signal.v1" as const;

/** Closed kind allowlist. Unknown kinds fail closed, never collected. */
export const TECH_SIGNAL_KINDS = [
  "meta-generator",
  "script-src",
  "stylesheet-href",
  "resource-hint",
  "dom-marker",
] as const;

export type TechSignalKind = (typeof TECH_SIGNAL_KINDS)[number];

/**
 * Capture-side budgets. Page-side candidate caps sum to exactly
 * maxSignals, so a honest offline render can never overflow the Node
 * gate; only crafted IPC can, and it fails closed.
 */
export const TECH_SIGNAL_BUDGET = {
  maxSignals: 200,
  maxMetaCandidates: 32,
  maxScriptCandidates: 100,
  maxStylesheetCandidates: 40,
  maxHintCandidates: 20,
  maxMarkerCandidates: 8,
  maxMetaChars: 256,
  maxMarkerChars: 256,
  maxUrlChars: 2_048,
  maxRefChars: 256,
  maxDetailChars: 64,
} as const;

/** Non-executable link relations approved for `resource-hint` evidence. */
export const TECH_SIGNAL_HINT_RELS = [
  "preload",
  "prefetch",
  "preconnect",
  "dns-prefetch",
  "modulepreload",
  "manifest",
] as const;

export type TechSignalErrorCode = "lens/invalid-tech-signal";

export class TechSignalError extends Error {
  readonly code: TechSignalErrorCode;
  constructor() {
    super("Lens technology-signal evidence is invalid or outside its budget.");
    this.name = "TechSignalError";
    this.code = "lens/invalid-tech-signal";
  }
}

/**
 * One observed technology signal. `value` is the normalized observed
 * string (resolved URL, metadata text, class string, or element tag for
 * attribute-name markers). `detail` records the attribute context
 * (`content`, `src`, `href`, `href:<rel>`, `class`, `attr:<name>`).
 * `ref` is a deterministic ASCII element path, never document text.
 */
export interface TechSignal {
  kind: TechSignalKind;
  value: string;
  ref: string;
  detail: string;
}

/** Raw path-linked snapshot before ref projection (page camel, Node seal). */
export interface TechPathSignal {
  kind: string;
  value: string;
  detail: string;
  segments: Array<{ tag: string; index: number }>;
}

function isKind(value: unknown): value is TechSignalKind {
  return (
    typeof value === "string" &&
    (TECH_SIGNAL_KINDS as readonly string[]).includes(value)
  );
}

const DETAIL_PATTERN = /^[a-z0-9:.-]{1,64}$/;

/**
 * Project path-linked snapshots into ref-keyed signals. Every ref is
 * built by `elementRef`, so refs stay deterministic ASCII paths.
 * Index-based iteration: Array.map skips sparse-array holes, which must
 * fail closed here.
 */
export function projectTechPathSignals(items: TechPathSignal[]): TechSignal[] {
  if (!Array.isArray(items) || items.length > TECH_SIGNAL_BUDGET.maxSignals) {
    throw new TechSignalError();
  }
  const projected: TechSignal[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] as unknown;
    if (!item || typeof item !== "object") throw new TechSignalError();
    const candidate = item as Partial<TechPathSignal>;
    if (
      !isKind(candidate.kind) ||
      typeof candidate.value !== "string" ||
      typeof candidate.detail !== "string" ||
      !Array.isArray(candidate.segments)
    ) {
      throw new TechSignalError();
    }
    projected.push({
      kind: candidate.kind,
      value: candidate.value,
      ref: projectRef(candidate.segments),
      detail: candidate.detail,
    });
  }
  return projected;
}

function projectRef(segments: TechPathSignal["segments"]): string {
  try {
    return elementRef(segments);
  } catch {
    throw new TechSignalError();
  }
}

function ordered(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Validate, dedupe, and deterministically order raw signals.
 *
 * - Unknown kinds, malformed shapes, oversized values/refs/details,
 *   over-count corpora, and sparse-array holes fail closed.
 * - Exact duplicates (all four fields equal) collapse to one observation.
 * - Output order is deterministic: kind, value, ref, detail.
 * - No confidence scores, no technology identities, no invented fields.
 */
export function collectTechSignals(signals: TechSignal[]): TechSignal[] {
  if (!Array.isArray(signals) || signals.length > TECH_SIGNAL_BUDGET.maxSignals) {
    throw new TechSignalError();
  }
  const seen = new Set<string>();
  const validated: TechSignal[] = [];
  // Index-based: every/some/forEach skip sparse-array holes, which would
  // otherwise let a holey array pass as valid evidence.
  for (let i = 0; i < signals.length; i += 1) {
    const signal = (signals as unknown[])[i] as unknown;
    if (signal === null || typeof signal !== "object") throw new TechSignalError();
    const candidate = signal as Partial<TechSignal>;
    if (!isKind(candidate.kind)) throw new TechSignalError();
    if (
      typeof candidate.value !== "string" ||
      candidate.value.length === 0 ||
      candidate.value.length > TECH_SIGNAL_BUDGET.maxUrlChars ||
      (candidate.kind === "meta-generator" &&
        candidate.value.length > TECH_SIGNAL_BUDGET.maxMetaChars) ||
      (candidate.kind === "dom-marker" &&
        candidate.value.length > TECH_SIGNAL_BUDGET.maxMarkerChars)
    ) {
      throw new TechSignalError();
    }
    if (
      typeof candidate.ref !== "string" ||
      candidate.ref.length === 0 ||
      candidate.ref.length > TECH_SIGNAL_BUDGET.maxRefChars
    ) {
      throw new TechSignalError();
    }
    if (
      typeof candidate.detail !== "string" ||
      candidate.detail.length === 0 ||
      candidate.detail.length > TECH_SIGNAL_BUDGET.maxDetailChars ||
      !DETAIL_PATTERN.test(candidate.detail)
    ) {
      throw new TechSignalError();
    }
    // Fixed keys only: never promote page-controlled strings to object
    // keys, so `__proto__`/prototype pollution has no sink here.
    const clean: TechSignal = {
      kind: candidate.kind,
      value: candidate.value,
      ref: candidate.ref,
      detail: candidate.detail,
    };
    const key = `${clean.kind}\u0000${clean.value}\u0000${clean.ref}\u0000${clean.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    validated.push(clean);
  }
  validated.sort(
    (a, b) =>
      ordered(a.kind, b.kind) ||
      ordered(a.value, b.value) ||
      ordered(a.ref, b.ref) ||
      ordered(a.detail, b.detail),
  );
  return validated;
}

/**
 * Fail-closed shape check for worker-produced technology signals,
 * mirroring `validCaptureDeclarations`. Used by the capture parent IPC
 * gate and the report assembly gate.
 */
export function validTechSignals(value: unknown): value is TechSignal[] {
  if (!Array.isArray(value) || value.length > TECH_SIGNAL_BUDGET.maxSignals) {
    return false;
  }
  try {
    collectTechSignals(value as TechSignal[]);
  } catch {
    return false;
  }
  // collectTechSignals dedupes; a duplicate-bearing array is still
  // well-formed evidence, so length drift after dedupe is not a failure.
  return true;
}
