/**
 * G09-09: source-linked style evidence for Skelet Lens.
 *
 * Pure, offline, dependency-free projection of raw computed-style snapshots
 * (collected by the capture worker from an offline, JavaScript-disabled
 * render) into bounded `StyleDeclaration` inputs for the design-token
 * extractor. It never visits a URL, never resolves `var()` references,
 * never expands shorthands, and never invents values.
 *
 * Trust boundary: computed values are attacker-influenced page DATA, not
 * CSS/program instructions. This module preserves them verbatim (clipped);
 * the report layer must escape them before rendering or re-emitting.
 */
import type { StyleDeclaration } from "./design-tokens.ts";

/** Computed-safe longhands consumed by the token extractor. Mirrors its contract. */
export const STYLE_EVIDENCE_PROPERTIES: readonly string[] = [
  "color",
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
  "column-rule-color",
  "caret-color",
  "accent-color",
  "fill",
  "stroke",
  "stop-color",
  "flood-color",
  "lighting-color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "gap",
  "row-gap",
  "column-gap",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "border-radius",
  "box-shadow",
  "text-shadow",
  "transition-duration",
  "animation-duration",
  "transition-timing-function",
  "animation-timing-function",
];

/**
 * Capture-side budgets. 32 elements x 43 properties = 1,376 declarations
 * worst case, under maxDeclarations. Tighter than the extractor's own
 * 20,000-declaration budget so oversized pages fail closed at capture.
 */
export const STYLE_EVIDENCE_BUDGET = {
  maxElements: 32,
  maxDeclarations: 1_500,
  maxRefChars: 256,
  maxValueChars: 512,
} as const;

export type StyleEvidenceErrorCode = "lens/invalid-style-evidence";

export class StyleEvidenceError extends Error {
  readonly code: StyleEvidenceErrorCode;
  constructor() {
    super("Lens style evidence is invalid or outside its budget.");
    this.name = "StyleEvidenceError";
    this.code = "lens/invalid-style-evidence";
  }
}

/** One element's observed computed snapshot, as produced by the capture worker. */
export interface StyleSnapshot {
  ref: string;
  styles: Record<string, string>;
}

/** One element's path-linked snapshot before ref projection (page camel, Node seal). */
export interface StylePathSnapshot {
  segments: Array<{ tag: string; index: number }>;
  styles: Record<string, string>;
}

/**
 * Project path-linked snapshots into ref-keyed snapshots. Every ref is
 * built by `elementRef`, so refs stay deterministic ASCII paths.
 */
export function projectPathSnapshots(items: StylePathSnapshot[]): StyleSnapshot[] {
  if (!Array.isArray(items) || items.length > STYLE_EVIDENCE_BUDGET.maxElements) {
    throw new StyleEvidenceError();
  }
  // Index-based: Array.map skips sparse-array holes, which must fail closed here.
  const projected: StyleSnapshot[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] as unknown;
    if (!item || typeof item !== "object") throw new StyleEvidenceError();
    const candidate = item as Partial<StylePathSnapshot>;
    if (!Array.isArray(candidate.segments) ||
        !candidate.styles || typeof candidate.styles !== "object") {
      throw new StyleEvidenceError();
    }
    projected.push({ ref: elementRef(candidate.segments), styles: candidate.styles });
  }
  return projected;
}

/**
 * Project raw computed snapshots into extractor-ready declarations.
 * Unknown properties are dropped (never guessed); over-budget or
 * malformed input fails closed. Output order is deterministic:
 * input order, then allowlist order.
 */
export function collectStyleEvidence(snapshots: StyleSnapshot[]): StyleDeclaration[] {
  if (!Array.isArray(snapshots) || snapshots.length > STYLE_EVIDENCE_BUDGET.maxElements) {
    throw new StyleEvidenceError();
  }
  const declarations: StyleDeclaration[] = [];
  for (const snapshot of snapshots) {
    if (!snapshot || typeof snapshot.ref !== "string" ||
        snapshot.ref.length === 0 || snapshot.ref.length > STYLE_EVIDENCE_BUDGET.maxRefChars ||
        !snapshot.styles || typeof snapshot.styles !== "object") {
      throw new StyleEvidenceError();
    }
    for (const property of STYLE_EVIDENCE_PROPERTIES) {
      const raw = (snapshot.styles as Record<string, unknown>)[property];
      if (typeof raw !== "string" || raw.length === 0) continue;
      if (raw.length > STYLE_EVIDENCE_BUDGET.maxValueChars) {
        throw new StyleEvidenceError();
      }
      declarations.push({ ref: snapshot.ref, property, value: raw });
      if (declarations.length > STYLE_EVIDENCE_BUDGET.maxDeclarations) {
        throw new StyleEvidenceError();
      }
    }
  }
  return declarations;
}

/**
 * Build a stable, deterministic element reference from a tag path.
 * Each segment is `tag:nth(index)`; the path is capped so refs stay
 * short, ASCII, and independent of document text or attributes.
 */
export function elementRef(segments: Array<{ tag: string; index: number }>): string {
  if (!Array.isArray(segments) || segments.length === 0 || segments.length > 6) {
    throw new StyleEvidenceError();
  }
  const parts: string[] = [];
  for (const segment of segments) {
    if (!segment || typeof segment.tag !== "string" || !Number.isSafeInteger(segment.index) ||
        segment.index < 0 || segment.index > 9999) {
      throw new StyleEvidenceError();
    }
    const tag = segment.tag.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 16);
    if (tag.length === 0) throw new StyleEvidenceError();
    parts.push(`${tag}:nth(${String(segment.index)})`);
  }
  const ref = parts.join(" > ");
  if (ref.length > STYLE_EVIDENCE_BUDGET.maxRefChars) throw new StyleEvidenceError();
  return ref;
}
