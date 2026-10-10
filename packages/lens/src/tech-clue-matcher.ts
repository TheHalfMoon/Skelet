/**
 * G09-12: Skelet-owned deterministic technology-clue matcher.
 *
 * Pure, offline, dependency-free projection of G09-11 technology-signal
 * OBSERVATIONS into evidence-graded technology CLUES. It never visits a
 * URL, never fetches anything, never executes code, and never imports the
 * GPL-3.0 runtime dataset identified in the G09-06 OpenTechAlyzer
 * evaluation. Rules are a small hand-authored Skelet-owned set shaped by
 * the evidence-graded engine reference (per-pattern confidence, truncated
 * evidence, fail-soft non-matches); live collectors, external enrichment,
 * and runtime dataset merging stay out of scope.
 *
 * Pipeline separation (never collapse these):
 *
 *   Observed evidence (G09-11 TechSignal) -> Matched rules -> Technology clues
 *
 * A clue is a heuristic evidence-graded match with an explicit confidence
 * below 1.0, linked rule ids, and linked signal refs. It is NEVER a
 * verified installation fact. Reports and exports must keep that framing.
 *
 * G05-02 conformance: the matcher runs behind a provider-shaped
 * descriptor (TECH_CLUE_PROVIDER below: stable id/capability/version,
 * deterministic config, input/output guards, health, provenance, egress
 * and cost declarations) mirroring packages/providers/src/provider.ts
 * field-for-field, without adding a runtime dependency.
 */

import {
  TECH_SIGNAL_BUDGET,
  validTechSignals,
  type TechSignal,
} from "./tech-signal-evidence.ts";

/** Version of the hand-authored rule set below. Bump on any rule change. */
export const TECH_CLUE_RULES_VERSION = "skelet.tech-rules.v1" as const;

/** Hard output budgets. Inputs reuse the G09-11 signal budget. */
export const TECH_CLUE_BUDGET = {
  maxClues: 20,
  maxRefsPerClue: 10,
  maxTechnologyChars: 64,
  maxRuleIdChars: 64,
} as const;

export type TechRuleMatch =
  | { type: "generator-prefix"; token: string }
  | { type: "host-suffix"; suffixes: string[] }
  | { type: "path-token"; tokens: string[] }
  | { type: "path-prefix"; prefixes: string[] };

export interface TechRule {
  /** Stable rule identity, e.g. "gen-wordpress". */
  id: string;
  /** Human technology label. A label, not an installation proof. */
  technology: string;
  /** Signal kinds this rule examines (URLs for host/path, generator meta). */
  kinds: TechSignal["kind"][];
  match: TechRuleMatch;
  /** Calibrated confidence in (0, 1). No rule may claim 1.0. */
  confidence: number;
  /** Why this pattern is evidence (one line, no invented sources). */
  rationale: string;
  /** Known way this rule can be wrong. Rendered alongside matches. */
  fpNote: string;
}

export interface TechnologyClue {
  technology: string;
  confidence: number;
  ruleIds: string[];
  evidenceRefs: string[];
  truncatedRefs: boolean;
}

export type TechClueErrorCode = "lens/invalid-tech-clue-input";

export class TechClueError extends Error {
  readonly code: TechClueErrorCode;
  constructor() {
    super("Lens technology-clue input is invalid or outside its budget.");
    this.name = "TechClueError";
    this.code = "lens/invalid-tech-clue-input";
  }
}

/**
 * The v1 rule set. Deliberately small and conservative: self-identifying
 * generator banners match at high confidence with prefix anchoring (a
 * mid-string mention does NOT match); URL host/path markers match at low
 * confidence because paths and CDN hosts are easily mimicked. dom-marker
 * signals are collected but unmatched in v1 (no verified marker rule).
 */
export const TECH_CLUE_RULES: readonly TechRule[] = Object.freeze([
  {
    id: "gen-wordpress",
    technology: "WordPress",
    kinds: ["meta-generator"],
    match: { type: "generator-prefix", token: "wordpress" },
    confidence: 0.85,
    rationale: "Self-identifying CMS generator banner with a fixed product prefix.",
    fpNote: "Generator banners can be spoofed or left by migrations; a prefix match is not an installation proof.",
  },
  {
    id: "gen-drupal",
    technology: "Drupal",
    kinds: ["meta-generator"],
    match: { type: "generator-prefix", token: "drupal" },
    confidence: 0.85,
    rationale: "Self-identifying CMS generator banner with a fixed product prefix.",
    fpNote: "Generator banners can be spoofed or left by migrations; a prefix match is not an installation proof.",
  },
  {
    id: "gen-joomla",
    technology: "Joomla",
    kinds: ["meta-generator"],
    match: { type: "generator-prefix", token: "joomla!" },
    confidence: 0.85,
    rationale: "Self-identifying CMS generator banner with a fixed product prefix.",
    fpNote: "Generator banners can be spoofed or left by migrations; a prefix match is not an installation proof.",
  },
  {
    id: "gen-ghost",
    technology: "Ghost",
    kinds: ["meta-generator"],
    match: { type: "generator-prefix", token: "ghost" },
    confidence: 0.85,
    rationale: "Self-identifying CMS generator banner with a fixed product prefix.",
    fpNote: "Generator banners can be spoofed or left by migrations; a prefix match is not an installation proof.",
  },
  {
    id: "gen-hugo",
    technology: "Hugo",
    kinds: ["meta-generator"],
    match: { type: "generator-prefix", token: "hugo" },
    confidence: 0.85,
    rationale: "Self-identifying static-site generator banner with a fixed product prefix.",
    fpNote: "Generator banners can be spoofed or left by migrations; a prefix match is not an installation proof.",
  },
  {
    id: "gen-jekyll",
    technology: "Jekyll",
    kinds: ["meta-generator"],
    match: { type: "generator-prefix", token: "jekyll" },
    confidence: 0.85,
    rationale: "Self-identifying static-site generator banner with a fixed product prefix.",
    fpNote: "Generator banners can be spoofed or left by migrations; a prefix match is not an installation proof.",
  },
  {
    id: "url-shopify",
    technology: "Shopify",
    kinds: ["script-src", "stylesheet-href", "resource-hint"],
    match: { type: "host-suffix", suffixes: ["cdn.shopify.com", "myshopify.com", "shopify.com"] },
    confidence: 0.6,
    rationale: "First-party Shopify asset or storefront host.",
    fpNote: "Third-party sites can load Shopify assets (e.g. Buy Button); host presence alone does not prove the analyzed site runs on Shopify.",
  },
  {
    id: "path-wordpress",
    technology: "WordPress",
    kinds: ["script-src", "stylesheet-href", "resource-hint"],
    match: { type: "path-token", tokens: ["wp-includes", "wp-content"] },
    confidence: 0.5,
    rationale: "WordPress-owned directory names as full path segments.",
    fpNote: "Directory names can be mimicked or copied statically; token presence alone does not prove a live WordPress install.",
  },
  {
    id: "path-nextjs",
    technology: "Next.js",
    kinds: ["script-src", "stylesheet-href", "resource-hint"],
    match: { type: "path-token", tokens: ["_next"] },
    confidence: 0.5,
    rationale: "Next.js build-output directory as a full path segment.",
    fpNote: "Exported or copied Next.js builds keep the directory name; token presence alone does not prove a live Next.js server.",
  },
  {
    id: "path-ghost-admin",
    technology: "Ghost",
    kinds: ["script-src", "stylesheet-href", "resource-hint"],
    match: { type: "path-prefix", prefixes: ["/ghost/"] },
    confidence: 0.55,
    rationale: "Ghost administration path prefix.",
    fpNote: "The prefix is short and could collide with unrelated content paths; prefix presence alone does not prove a Ghost install.",
  },
] as const as readonly TechRule[]);

function ordered(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function ruleHits(rule: TechRule, signal: TechSignal): boolean {
  if (!rule.kinds.includes(signal.kind)) return false;
  const match = rule.match;
  switch (match.type) {
    case "generator-prefix":
      // Prefix-anchored: a mid-string mention ("not wordpress") is NOT a hit.
      return signal.value.toLowerCase().startsWith(match.token);
    case "host-suffix":
    case "path-token":
    case "path-prefix": {
      let url: URL;
      try {
        url = new URL(signal.value);
      } catch {
        return false;
      }
      if (match.type === "host-suffix") {
        const host = url.hostname.toLowerCase();
        return match.suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
      }
      const path = url.pathname.toLowerCase();
      if (match.type === "path-prefix") {
        return match.prefixes.some((prefix) => path.startsWith(prefix));
      }
      // Full-segment equality: "mynextapp" and "my_next_post" never equal
      // "_next", and "wordpress-backup" never equals "wp-content".
      const segments = path.split("/").filter((part) => part.length > 0);
      return match.tokens.some((token) => segments.includes(token));
    }
  }
}

/**
 * Fail-closed shape check for matcher-produced clues. Used by the report
 * assembly gate and the export surface gate.
 */
export function validTechnologyClues(value: unknown): value is TechnologyClue[] {
  if (!Array.isArray(value) || value.length > TECH_CLUE_BUDGET.maxClues) return false;
  // Index-based: Array.every skips sparse-array holes, which must fail here.
  for (let i = 0; i < value.length; i += 1) {
    const clue = (value as unknown[])[i] as unknown;
    if (clue === null || typeof clue !== "object") return false;
    const candidate = clue as Partial<TechnologyClue>;
    if (
      typeof candidate.technology !== "string" ||
      candidate.technology.length === 0 ||
      candidate.technology.length > TECH_CLUE_BUDGET.maxTechnologyChars
    ) {
      return false;
    }
    if (
      typeof candidate.confidence !== "number" ||
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence <= 0 ||
      candidate.confidence >= 1
    ) {
      return false;
    }
    if (
      !Array.isArray(candidate.ruleIds) ||
      candidate.ruleIds.length === 0 ||
      candidate.ruleIds.length > TECH_CLUE_RULES.length
    ) {
      return false;
    }
    for (let r = 0; r < candidate.ruleIds.length; r += 1) {
      const id = (candidate.ruleIds as unknown[])[r] as unknown;
      if (typeof id !== "string" || id.length === 0 || id.length > TECH_CLUE_BUDGET.maxRuleIdChars) {
        return false;
      }
    }
    if (!Array.isArray(candidate.evidenceRefs) || candidate.evidenceRefs.length === 0) return false;
    for (let e = 0; e < candidate.evidenceRefs.length; e += 1) {
      const ref = (candidate.evidenceRefs as unknown[])[e] as unknown;
      if (typeof ref !== "string" || ref.length === 0 || ref.length > TECH_SIGNAL_BUDGET.maxRefChars) {
        return false;
      }
    }
    if (candidate.evidenceRefs.length > TECH_CLUE_BUDGET.maxRefsPerClue) return false;
    if (typeof candidate.truncatedRefs !== "boolean") return false;
  }
  return true;
}

/**
 * Project validated signals into evidence-graded clues. Invalid, sparse,
 * or over-budget input fails closed. Output is deterministic: clues sort
 * by confidence descending, then technology ascending; rule ids and
 * evidence refs sort ascending. Same-technology hits merge into one clue
 * at the highest confidence with the union of rule ids and refs.
 */
export function matchTechnologyClues(signals: TechSignal[]): TechnologyClue[] {
  if (!validTechSignals(signals)) throw new TechClueError();
  const byTechnology = new Map<string, { confidence: number; ruleIds: Set<string>; refs: Set<string> }>();
  for (let i = 0; i < signals.length; i += 1) {
    const signal = (signals as TechSignal[])[i] as TechSignal;
    for (const rule of TECH_CLUE_RULES) {
      if (!ruleHits(rule, signal)) continue;
      let entry = byTechnology.get(rule.technology);
      if (entry === undefined) {
        entry = { confidence: 0, ruleIds: new Set(), refs: new Set() };
        byTechnology.set(rule.technology, entry);
      }
      if (rule.confidence > entry.confidence) entry.confidence = rule.confidence;
      entry.ruleIds.add(rule.id);
      entry.refs.add(signal.ref);
    }
  }
  const clues: TechnologyClue[] = [];
  for (const [technology, entry] of byTechnology) {
    const refs = [...entry.refs].sort();
    const truncatedRefs = refs.length > TECH_CLUE_BUDGET.maxRefsPerClue;
    clues.push({
      technology,
      confidence: entry.confidence,
      ruleIds: [...entry.ruleIds].sort(),
      evidenceRefs: truncatedRefs ? refs.slice(0, TECH_CLUE_BUDGET.maxRefsPerClue) : refs,
      truncatedRefs,
    });
  }
  clues.sort((a, b) => b.confidence - a.confidence || ordered(a.technology, b.technology));
  if (clues.length > TECH_CLUE_BUDGET.maxClues) throw new TechClueError();
  return clues;
}

/**
 * G05-02-shaped provider descriptor for the matcher (structural mirror of
 * packages/providers/src/provider.ts; no runtime dependency). Execution
 * and data stay local: egress "none", cost "free-local".
 */
export const TECH_CLUE_PROVIDER = {
  id: "skelet-tech-clues",
  capability: "technology-clues",
  version: TECH_CLUE_RULES_VERSION,
  egress: "none",
  costClass: "free-local",
  config: Object.freeze({
    rulesVersion: TECH_CLUE_RULES_VERSION,
    ruleIds: TECH_CLUE_RULES.map((rule) => rule.id),
    maxClues: TECH_CLUE_BUDGET.maxClues,
    maxRefsPerClue: TECH_CLUE_BUDGET.maxRefsPerClue,
  }),
  checkInput: validTechSignals,
  checkOutput: validTechnologyClues,
  invoke: async (input: TechSignal[]): Promise<TechnologyClue[]> => matchTechnologyClues(input),
  health: async (): Promise<{ ok: boolean; detail?: string }> => ({ ok: true, detail: "ready" }),
  provenance: (input: TechSignal[], output: TechnologyClue[]): Record<string, unknown> => ({
    providerId: "skelet-tech-clues",
    capability: "technology-clues",
    version: TECH_CLUE_RULES_VERSION,
    egress: "none",
    rulesVersion: TECH_CLUE_RULES_VERSION,
    rulesEvaluated: TECH_CLUE_RULES.length,
    signalsSeen: input.length,
    cluesEmitted: output.length,
  }),
} as const;
