/**
 * G09-02 deterministic design-token extractor for Skelet Lens.
 *
 * Pure, offline, dependency-free normalization over pre-extracted style
 * declarations. The capture layer (a later P09 grain) supplies computed or
 * stylesheet declarations; this module never fetches, never resolves
 * `var()` references, never expands shorthands, and never invents values.
 * Everything it emits is directly observed in the input. Anything it cannot
 * ground deterministically is reported under `unresolved` with a reason,
 * never silently dropped into a token and never guessed.
 *
 * Qualified input path: computed-style snapshots, which are always
 * longhand single values. Stylesheet input may yield `unresolved` entries
 * (shorthands, relative units, references); that is honest output, not a
 * defect: the report layer (later grain) must refuse a successful empty
 * analysis via `isEmpty` instead of presenting fabricated coverage.
 *
 * Supported color syntax: 3/4/6/8-digit hex, rgb()/rgba() (comma, space,
 * and slash forms, numbers, percentages, `none`), hsl()/hsla() (deg and
 * bare-number hues plus rad/grad/turn), the 148 CSS Color 4 keywords, and
 * `transparent`. Out-of-range channels are clamped exactly as the CSS
 * spec clamps them at computed-value time, so tokens match rendered
 * reality. Anything else functional (color-mix, light-dark, lab, lch,
 * oklab, hwb, color(), device-cmyk) is reported as `unsupported-syntax`.
 *
 * Single-value `border-radius` and single-value `gap` are promoted because
 * one value applies uniformly with no expansion ambiguity; multi-value
 * forms are never split across corners/axes and are reported as
 * `multi-value-not-expanded`. Properties outside the token contract
 * (layout, display, positioning) are ignored but counted in
 * `coverage.propertiesSeen`; ignoring them fabricates nothing.
 *
 * Trust boundary for re-emission: colors, lengths, durations, and easings
 * normalize into safe grammars, but shadow and font-family token strings
 * preserve attacker-influenced source text (including url() references).
 * They are honest observations, not sanitized output: the report layer
 * MUST CSS/HTML-escape them before rendering or re-emitting.
 *
 * Ordering is input-order independent: tokens sort by occurrences
 * descending, then value ascending; refs sort lexically; unresolved
 * entries sort by ref, property, value, reason; font-family stacks
 * normalize to lowercase. Refs are capped per token. `fingerprint` is a
 * non-cryptographic (cyrb53)
 * identity over the canonical payload for report correlation only; it is
 * not a security boundary and never substitutes for SHA-256 asset dedupe.
 */

export type TokenErrorCode = "lens/invalid-input";

export class TokenError extends Error {
  readonly code: TokenErrorCode;
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
    this.code = "lens/invalid-input";
  }
}

/** One raw style declaration from the capture layer. */
export interface StyleDeclaration {
  /** Stable source reference, e.g. selector or element path from capture. */
  ref: string;
  /** CSS property name (any case; normalized internally). */
  property: string;
  /** Raw declared or computed value. */
  value: string;
}

export type UnresolvedReason =
  | "shorthand-not-expanded"
  | "multi-value-not-expanded"
  | "relative-unit"
  | "context-dependent"
  | "unresolved-reference"
  | "unsupported-syntax"
  | "invalid-value"
  | "value-too-long";

export interface UnresolvedDeclaration {
  ref: string;
  property: string;
  /** Raw value truncated to a bounded length. */
  value: string;
  reason: UnresolvedReason;
}

export interface TokenObservation {
  /** Normalized token value. */
  value: string;
  occurrences: number;
  /** First-seen source refs, capped per token. */
  refs: string[];
}

export interface TypographyTokens {
  families: TokenObservation[];
  sizes: TokenObservation[];
  weights: TokenObservation[];
  lineHeights: TokenObservation[];
}

export interface MotionTokens {
  /** Normalized to whole-or-decimal milliseconds, e.g. "200ms". */
  durations: TokenObservation[];
  easings: TokenObservation[];
}

export interface TokenCoverage {
  declarationsSeen: number;
  declarationsUsed: number;
  refsSeen: number;
  /** Sorted unique normalized property names across all declarations. */
  propertiesSeen: string[];
}

export interface TokenProvenance {
  /** Token categories with at least one observation. */
  observed: string[];
  /** This extractor never infers; always empty, kept for contract parity. */
  inferred: string[];
}

export interface DesignTokens {
  version: 1;
  colors: TokenObservation[];
  typography: TypographyTokens;
  spacing: TokenObservation[];
  radius: TokenObservation[];
  shadows: TokenObservation[];
  motion: MotionTokens;
  unresolved: UnresolvedDeclaration[];
  unresolvedTruncated: boolean;
  coverage: TokenCoverage;
  provenance: TokenProvenance;
  /** True when every token array is empty; reports must not succeed on this. */
  isEmpty: boolean;
  fingerprint: string;
}

const MAX_DECLARATIONS = 20000;
const MAX_VALUE_CHARS = 2048;
const MAX_REF_CHARS = 1024;
const MAX_PROPERTY_CHARS = 256;
const MAX_REFS_PER_TOKEN = 10;
const MAX_UNRESOLVED = 200;
const MAX_SHADOW_PARTS = 64;
const STORED_VALUE_CHARS = 128;
/**
 * Above this magnitude JavaScript switches to exponential notation for
 * large values, which is not re-emittable CSS. Tokens must round-trip as
 * CSS, so larger magnitudes are rejected as invalid instead of fabricated
 * as observed. (Tiny fractions may still stringify exponentially, which
 * remains valid CSS `<number>` syntax and therefore stays promotable.)
 */
const MAX_CSS_NUMBER = 1e21;

const COLOR_PROPERTIES = new Set([
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
]);

const SPACING_PROPERTIES = new Set([
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
]);

const RADIUS_LONGHANDS = new Set([
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
]);

/** CSS Color Module Level 4 named colors (148 keywords).
 * Cross-verified against the TinyColor keyword table; the non-standard
 * `burntsienna` entry present there is intentionally excluded. Values are
 * lowercase 6-digit hex without the leading `#`. */
const NAMED_COLORS: Record<string, string> = {
  aliceblue: "f0f8ff",
  antiquewhite: "faebd7",
  aqua: "00ffff",
  aquamarine: "7fffd4",
  azure: "f0ffff",
  beige: "f5f5dc",
  bisque: "ffe4c4",
  black: "000000",
  blanchedalmond: "ffebcd",
  blue: "0000ff",
  blueviolet: "8a2be2",
  brown: "a52a2a",
  burlywood: "deb887",
  cadetblue: "5f9ea0",
  chartreuse: "7fff00",
  chocolate: "d2691e",
  coral: "ff7f50",
  cornflowerblue: "6495ed",
  cornsilk: "fff8dc",
  crimson: "dc143c",
  cyan: "00ffff",
  darkblue: "00008b",
  darkcyan: "008b8b",
  darkgoldenrod: "b8860b",
  darkgray: "a9a9a9",
  darkgreen: "006400",
  darkgrey: "a9a9a9",
  darkkhaki: "bdb76b",
  darkmagenta: "8b008b",
  darkolivegreen: "556b2f",
  darkorange: "ff8c00",
  darkorchid: "9932cc",
  darkred: "8b0000",
  darksalmon: "e9967a",
  darkseagreen: "8fbc8f",
  darkslateblue: "483d8b",
  darkslategray: "2f4f4f",
  darkslategrey: "2f4f4f",
  darkturquoise: "00ced1",
  darkviolet: "9400d3",
  deeppink: "ff1493",
  deepskyblue: "00bfff",
  dimgray: "696969",
  dimgrey: "696969",
  dodgerblue: "1e90ff",
  firebrick: "b22222",
  floralwhite: "fffaf0",
  forestgreen: "228b22",
  fuchsia: "ff00ff",
  gainsboro: "dcdcdc",
  ghostwhite: "f8f8ff",
  gold: "ffd700",
  goldenrod: "daa520",
  gray: "808080",
  green: "008000",
  greenyellow: "adff2f",
  grey: "808080",
  honeydew: "f0fff0",
  hotpink: "ff69b4",
  indianred: "cd5c5c",
  indigo: "4b0082",
  ivory: "fffff0",
  khaki: "f0e68c",
  lavender: "e6e6fa",
  lavenderblush: "fff0f5",
  lawngreen: "7cfc00",
  lemonchiffon: "fffacd",
  lightblue: "add8e6",
  lightcoral: "f08080",
  lightcyan: "e0ffff",
  lightgoldenrodyellow: "fafad2",
  lightgray: "d3d3d3",
  lightgreen: "90ee90",
  lightgrey: "d3d3d3",
  lightpink: "ffb6c1",
  lightsalmon: "ffa07a",
  lightseagreen: "20b2aa",
  lightskyblue: "87cefa",
  lightslategray: "778899",
  lightslategrey: "778899",
  lightsteelblue: "b0c4de",
  lightyellow: "ffffe0",
  lime: "00ff00",
  limegreen: "32cd32",
  linen: "faf0e6",
  magenta: "ff00ff",
  maroon: "800000",
  mediumaquamarine: "66cdaa",
  mediumblue: "0000cd",
  mediumorchid: "ba55d3",
  mediumpurple: "9370db",
  mediumseagreen: "3cb371",
  mediumslateblue: "7b68ee",
  mediumspringgreen: "00fa9a",
  mediumturquoise: "48d1cc",
  mediumvioletred: "c71585",
  midnightblue: "191970",
  mintcream: "f5fffa",
  mistyrose: "ffe4e1",
  moccasin: "ffe4b5",
  navajowhite: "ffdead",
  navy: "000080",
  oldlace: "fdf5e6",
  olive: "808000",
  olivedrab: "6b8e23",
  orange: "ffa500",
  orangered: "ff4500",
  orchid: "da70d6",
  palegoldenrod: "eee8aa",
  palegreen: "98fb98",
  paleturquoise: "afeeee",
  palevioletred: "db7093",
  papayawhip: "ffefd5",
  peachpuff: "ffdab9",
  peru: "cd853f",
  pink: "ffc0cb",
  plum: "dda0dd",
  powderblue: "b0e0e6",
  purple: "800080",
  rebeccapurple: "663399",
  red: "ff0000",
  rosybrown: "bc8f8f",
  royalblue: "4169e1",
  saddlebrown: "8b4513",
  salmon: "fa8072",
  sandybrown: "f4a460",
  seagreen: "2e8b57",
  seashell: "fff5ee",
  sienna: "a0522d",
  silver: "c0c0c0",
  skyblue: "87ceeb",
  slateblue: "6a5acd",
  slategray: "708090",
  slategrey: "708090",
  snow: "fffafa",
  springgreen: "00ff7f",
  steelblue: "4682b4",
  tan: "d2b48c",
  teal: "008080",
  thistle: "d8bfd8",
  tomato: "ff6347",
  turquoise: "40e0d0",
  violet: "ee82ee",
  wheat: "f5deb3",
  white: "ffffff",
  whitesmoke: "f5f5f5",
  yellow: "ffff00",
  yellowgreen: "9acd32",
};

const CONTEXT_KEYWORDS = new Set([
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

const UNSUPPORTED_COLOR_FUNCTIONS = new Set([
  "color-mix",
  "light-dark",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "hwb",
  "color",
  "device-cmyk",
]);

const EASING_KEYWORDS = new Set([
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
]);

const MATH_FUNCTIONS = ["calc(", "min(", "max(", "clamp("];

function containsMathFunction(raw: string): boolean {
  const lower = raw.toLowerCase();
  return MATH_FUNCTIONS.some((fn) => lower.includes(fn));
}

export const TOKEN_LIMITS = {
  maxDeclarations: MAX_DECLARATIONS,
  maxValueChars: MAX_VALUE_CHARS,
  maxRefChars: MAX_REF_CHARS,
  maxPropertyChars: MAX_PROPERTY_CHARS,
  maxRefsPerToken: MAX_REFS_PER_TOKEN,
  maxUnresolved: MAX_UNRESOLVED,
  maxShadowParts: MAX_SHADOW_PARTS,
} as const;

function clampByte(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function byteToHex(value: number): string {
  return clampByte(value).toString(16).padStart(2, "0");
}

/** Parse one rgb-component token: number, percentage, or `none`. */
function parseRgbComponent(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (text === "none") return 0;
  if (text.endsWith("%")) {
    const amount = Number(text.slice(0, -1));
    if (!Number.isFinite(amount)) return null;
    return clamp01(amount / 100) * 255;
  }
  const amount = Number(text);
  if (!Number.isFinite(amount)) return null;
  return amount;
}

function parseAlphaComponent(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (text === "none") return 0;
  if (text.endsWith("%")) {
    const amount = Number(text.slice(0, -1));
    if (!Number.isFinite(amount)) return null;
    return clamp01(amount / 100);
  }
  const amount = Number(text);
  if (!Number.isFinite(amount)) return null;
  return clamp01(amount);
}

function parseHueDegrees(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (text === "none") return 0;
  let amount: number;
  if (text.endsWith("deg")) amount = Number(text.slice(0, -3));
  else if (text.endsWith("grad")) amount = Number(text.slice(0, -4)) * 0.9;
  else if (text.endsWith("rad")) amount = (Number(text.slice(0, -3)) * 180) / Math.PI;
  else if (text.endsWith("turn")) amount = Number(text.slice(0, -4)) * 360;
  else amount = Number(text);
  if (!Number.isFinite(amount)) return null;
  return ((amount % 360) + 360) % 360;
}

function parsePercentageOnly(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (text === "none") return 0;
  if (!text.endsWith("%")) return null;
  const amount = Number(text.slice(0, -1));
  if (!Number.isFinite(amount)) return null;
  return clamp01(amount / 100);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function splitCommaArgs(inner: string): string[] | null {
  const parts = inner.split(",").map((part) => part.trim());
  if (parts.some((part) => part.length === 0 || /[\s/]/.test(part))) return null;
  return parts;
}

function splitSpaceArgs(inner: string): string[] {
  return inner
    .replaceAll("/", " / ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

type Rgba = [number, number, number, number];

function parseRgbFunction(fn: string, inner: string): Rgba | "invalid" | null {
  const legacy = inner.includes(",");
  if (legacy) {
    const parts = splitCommaArgs(inner);
    if (parts === null) return "invalid";
    if (parts.length !== 3 && parts.length !== 4) return "invalid";
    if (fn === "rgb" && parts.length === 4) return "invalid";
    const r = parseRgbComponent(parts[0] as string);
    const g = parseRgbComponent(parts[1] as string);
    const b = parseRgbComponent(parts[2] as string);
    if (r === null || g === null || b === null) return "invalid";
    if (parts.length === 3) return [r, g, b, 1];
    const a = parseAlphaComponent(parts[3] as string);
    if (a === null) return "invalid";
    return [r, g, b, a];
  }
  const parts = splitSpaceArgs(inner);
  if (parts.length !== 3 && !(parts.length === 5 && parts[3] === "/")) return "invalid";
  const r = parseRgbComponent(parts[0] as string);
  const g = parseRgbComponent(parts[1] as string);
  const b = parseRgbComponent(parts[2] as string);
  if (r === null || g === null || b === null) return "invalid";
  if (parts.length === 3) return [r, g, b, 1];
  const a = parseAlphaComponent(parts[4] as string);
  if (a === null) return "invalid";
  return [r, g, b, a];
}

function parseHslFunction(inner: string): Rgba | "invalid" {
  const legacy = inner.includes(",");
  const parts = legacy ? splitCommaArgs(inner) : splitSpaceArgs(inner);
  if (parts === null) return "invalid";
  const hasSlashAlpha = parts.length === 5 && parts[3] === "/";
  if (parts.length !== 3 && parts.length !== 4 && !hasSlashAlpha) return "invalid";
  if (!legacy && parts.length === 4) return "invalid";
  const h = parseHueDegrees(parts[0] as string);
  const s = parsePercentageOnly(parts[1] as string);
  const l = parsePercentageOnly(parts[2] as string);
  if (h === null || s === null || l === null) return "invalid";
  let a = 1;
  if (hasSlashAlpha || parts.length === 4) {
    const parsed = parseAlphaComponent(parts[hasSlashAlpha ? 4 : 3] as string);
    if (parsed === null) return "invalid";
    a = parsed;
  }
  const [r, g, b] = hslToRgb(h, s, l);
  return [r, g, b, a];
}

/**
 * Parse a CSS color value to clamped RGBA channels.
 * Returns the channels, "invalid" for malformed values, or null when the
 * value is well-formed but not a color this extractor grounds
 * (references, context keywords, unsupported functions).
 */
function parseColorValue(raw: string): { kind: "rgba"; rgba: Rgba } | { kind: "reference" } | { kind: "context" } | { kind: "unsupported" } | { kind: "invalid" } {
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (lower.length === 0) return { kind: "invalid" };
  if (lower === "transparent") return { kind: "rgba", rgba: [0, 0, 0, 0] };
  if (CONTEXT_KEYWORDS.has(lower)) return { kind: "context" };
  if (lower.includes("var(")) return { kind: "reference" };
  if (containsMathFunction(text)) return { kind: "unsupported" };
  const fnMatch = /^([a-z][a-z0-9-]*)\((.*)\)$/s.exec(lower);
  if (fnMatch !== null) {
    const fn = fnMatch[1] as string;
    const inner = fnMatch[2] as string;
    if (UNSUPPORTED_COLOR_FUNCTIONS.has(fn)) return { kind: "unsupported" };
    if (fn === "rgb" || fn === "rgba") {
      const parsed = parseRgbFunction(fn, inner);
      if (parsed === "invalid" || parsed === null) return { kind: "invalid" };
      return { kind: "rgba", rgba: parsed };
    }
    if (fn === "hsl" || fn === "hsla") {
      const parsed = parseHslFunction(inner);
      if (parsed === "invalid") return { kind: "invalid" };
      return { kind: "rgba", rgba: parsed };
    }
    return { kind: "invalid" };
  }
  if (Object.hasOwn(NAMED_COLORS, lower)) {
    const hex = NAMED_COLORS[lower] as string;
    return {
      kind: "rgba",
      rgba: [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        1,
      ],
    };
  }
  if (text.startsWith("#")) {
    const hex = lower.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return { kind: "invalid" };
    let expanded = hex;
    if (hex.length === 3 || hex.length === 4) {
      expanded = hex
        .split("")
        .map((ch) => ch + ch)
        .join("");
    }
    if (expanded.length !== 6 && expanded.length !== 8) return { kind: "invalid" };
    const r = parseInt(expanded.slice(0, 2), 16);
    const g = parseInt(expanded.slice(2, 4), 16);
    const b = parseInt(expanded.slice(4, 6), 16);
    let a = 1;
    if (expanded.length === 8) a = clamp01(parseInt(expanded.slice(6, 8), 16) / 255);
    return { kind: "rgba", rgba: [r, g, b, a] };
  }
  return { kind: "invalid" };
}

function rgbaToToken(rgba: Rgba): string {
  const [r, g, b, a] = rgba;
  if (a >= 1) return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
  return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}${byteToHex(a * 255)}`;
}

/**
 * Format a number as re-emittable CSS. Returns null for non-finite values
 * and magnitudes JavaScript would stringify in exponential notation, so
 * tokens never carry values that are not valid observed CSS.
 */
function formatCssNumber(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) >= MAX_CSS_NUMBER) return null;
  return String(value);
}

/** Normalize an absolute pixel length; null when not a plain px value. */
function parsePxLength(raw: string): { px: number } | { relative: true } | null {
  const text = raw.trim().toLowerCase();
  if (text === "0") return { px: 0 };
  const match = /^(-?\d*\.?\d+)px$/.exec(text);
  if (match !== null) {
    const px = Number(match[1]);
    if (!Number.isFinite(px)) return null;
    return { px };
  }
  if (/^(-?\d*\.?\d+)(rem|em|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|cqw|cqh|cqi|cqb|cqmin|cqmax|pt|pc|in|cm|mm|q|%)$/.test(text)) {
    return { relative: true };
  }
  return null;
}

function splitTopLevelCommas(raw: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | null = null;
  for (const ch of raw) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === "(") {
      depth += 1;
      current += ch;
    } else if (ch === ")") {
      depth -= 1;
      if (depth < 0) return null;
      current += ch;
    } else if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (quote !== null || depth !== 0) return null;
  parts.push(current);
  return parts;
}

function stripSurroundingQuotes(raw: string): string {
  const text = raw.trim();
  if (text.length >= 2) {
    const first = text[0] as string;
    const last = text[text.length - 1] as string;
    if ((first === '"' || first === "'") && first === last) return text.slice(1, -1).trim();
  }
  return text;
}

function normalizeWhitespace(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

interface TokenAccumulator {
  value: string;
  occurrences: number;
  seenRefs: Set<string>;
}

function finalizeAccumulator(map: Map<string, TokenAccumulator>): TokenObservation[] {
  const entries = [...map.values()];
  entries.sort((a, b) => {
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
    if (a.value === b.value) return 0;
    return a.value < b.value ? -1 : 1;
  });
  return entries.map((entry) => ({
    value: entry.value,
    occurrences: entry.occurrences,
    refs: [...entry.seenRefs].sort().slice(0, MAX_REFS_PER_TOKEN),
  }));
}

function sortUnresolved(entries: UnresolvedDeclaration[]): UnresolvedDeclaration[] {
  return [...entries].sort((a, b) => {
    if (a.ref !== b.ref) return a.ref < b.ref ? -1 : 1;
    if (a.property !== b.property) return a.property < b.property ? -1 : 1;
    if (a.value !== b.value) return a.value < b.value ? -1 : 1;
    if (a.reason === b.reason) return 0;
    return a.reason < b.reason ? -1 : 1;
  });
}

function cyrb53(input: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function fingerprintPayload(payload: string): string {
  const first = cyrb53(payload, 0x9e37).toString(16).padStart(14, "0");
  const second = cyrb53(payload, 0x85eb).toString(16).padStart(14, "0");
  return `${first}${second}`;
}

interface ExtractorState {
  colors: Map<string, TokenAccumulator>;
  families: Map<string, TokenAccumulator>;
  sizes: Map<string, TokenAccumulator>;
  weights: Map<string, TokenAccumulator>;
  lineHeights: Map<string, TokenAccumulator>;
  spacing: Map<string, TokenAccumulator>;
  radius: Map<string, TokenAccumulator>;
  shadows: Map<string, TokenAccumulator>;
  durations: Map<string, TokenAccumulator>;
  easings: Map<string, TokenAccumulator>;
  unresolved: UnresolvedDeclaration[];
  unresolvedTruncated: boolean;
  propertiesSeen: Set<string>;
  refsSeen: Set<string>;
  used: number;
}

function recordToken(map: Map<string, TokenAccumulator>, key: string, value: string, ref: string): void {
  let entry = map.get(key);
  if (entry === undefined) {
    entry = { value, occurrences: 0, seenRefs: new Set() };
    map.set(key, entry);
  }
  entry.occurrences += 1;
  entry.seenRefs.add(ref);
}

function recordUnresolved(state: ExtractorState, ref: string, property: string, value: string, reason: UnresolvedReason): void {
  if (state.unresolved.length >= MAX_UNRESOLVED) {
    state.unresolvedTruncated = true;
    return;
  }
  state.unresolved.push({
    ref,
    property,
    value: value.length > STORED_VALUE_CHARS ? value.slice(0, STORED_VALUE_CHARS) : value,
    reason,
  });
}

function handleColor(state: ExtractorState, ref: string, property: string, rawValue: string): void {
  const parsed = parseColorValue(rawValue);
  if (parsed.kind === "rgba") {
    recordToken(state.colors, rgbaToToken(parsed.rgba), rgbaToToken(parsed.rgba), ref);
    state.used += 1;
    return;
  }
  if (parsed.kind === "reference") {
    recordUnresolved(state, ref, property, rawValue, "unresolved-reference");
    return;
  }
  if (parsed.kind === "context") {
    recordUnresolved(state, ref, property, rawValue, "context-dependent");
    return;
  }
  if (parsed.kind === "unsupported") {
    recordUnresolved(state, ref, property, rawValue, "unsupported-syntax");
    return;
  }
  recordUnresolved(state, ref, property, rawValue, "invalid-value");
}

function handleFontFamily(state: ExtractorState, ref: string, property: string, rawValue: string): void {
  const items = splitTopLevelCommas(rawValue);
  if (items === null) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  const cleaned = items
    .map((item) => normalizeWhitespace(stripSurroundingQuotes(item)))
    .filter((item) => item.length > 0);
  if (cleaned.length === 0) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  const value = cleaned.join(", ").toLowerCase();
  recordToken(state.families, value, value, ref);
  state.used += 1;
}

function handleFontSize(state: ExtractorState, ref: string, property: string, rawValue: string): void {
  if (containsMathFunction(rawValue)) {
    recordUnresolved(state, ref, property, rawValue, "unsupported-syntax");
    return;
  }
  const parsed = parsePxLength(rawValue);
  if (parsed === null) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  if ("relative" in parsed) {
    recordUnresolved(state, ref, property, rawValue, "relative-unit");
    return;
  }
  if (parsed.px < 0) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  const formatted = formatCssNumber(parsed.px);
  if (formatted === null) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  const value = `${formatted}px`;
  recordToken(state.sizes, value, value, ref);
  state.used += 1;
}

function handleFontWeight(state: ExtractorState, ref: string, property: string, rawValue: string): void {
  if (containsMathFunction(rawValue)) {
    recordUnresolved(state, ref, property, rawValue, "unsupported-syntax");
    return;
  }
  const text = rawValue.trim().toLowerCase();
  if (text === "normal") {
    recordToken(state.weights, "400", "400", ref);
    state.used += 1;
    return;
  }
  if (text === "bold") {
    recordToken(state.weights, "700", "700", ref);
    state.used += 1;
    return;
  }
  if (text === "bolder" || text === "lighter") {
    recordUnresolved(state, ref, property, rawValue, "context-dependent");
    return;
  }
  if (/^\d{1,4}$/.test(text)) {
    const weight = Number(text);
    if (weight >= 1 && weight <= 1000) {
      const value = String(weight);
      recordToken(state.weights, value, value, ref);
      state.used += 1;
      return;
    }
  }
  recordUnresolved(state, ref, property, rawValue, "invalid-value");
}

function handleLineHeight(state: ExtractorState, ref: string, property: string, rawValue: string): void {
  if (containsMathFunction(rawValue)) {
    recordUnresolved(state, ref, property, rawValue, "unsupported-syntax");
    return;
  }
  const text = rawValue.trim().toLowerCase();
  if (text === "normal") {
    recordToken(state.lineHeights, "normal", "normal", ref);
    state.used += 1;
    return;
  }
  const px = parsePxLength(rawValue);
  if (px !== null) {
    if ("relative" in px) {
      recordUnresolved(state, ref, property, rawValue, "relative-unit");
      return;
    }
    if (px.px < 0) {
      recordUnresolved(state, ref, property, rawValue, "invalid-value");
      return;
    }
    const formatted = formatCssNumber(px.px);
    if (formatted === null) {
      recordUnresolved(state, ref, property, rawValue, "invalid-value");
      return;
    }
    const value = `${formatted}px`;
    recordToken(state.lineHeights, value, value, ref);
    state.used += 1;
    return;
  }
  if (/^\d*\.?\d+$/.test(text)) {
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount < 0) {
      recordUnresolved(state, ref, property, rawValue, "invalid-value");
      return;
    }
    const formatted = formatCssNumber(amount);
    if (formatted === null) {
      recordUnresolved(state, ref, property, rawValue, "invalid-value");
      return;
    }
    recordToken(state.lineHeights, formatted, formatted, ref);
    state.used += 1;
    return;
  }
  recordUnresolved(state, ref, property, rawValue, "invalid-value");
}

function handleAbsoluteLength(
  state: ExtractorState,
  map: Map<string, TokenAccumulator>,
  ref: string,
  property: string,
  rawValue: string,
  allowNegative: boolean,
): void {
  const text = rawValue.trim();
  if (containsMathFunction(text)) {
    recordUnresolved(state, ref, property, rawValue, "unsupported-syntax");
    return;
  }
  if (text.length === 0 || /[\s,]/.test(text)) {
    recordUnresolved(
      state,
      ref,
      property,
      rawValue,
      text.length === 0 ? "invalid-value" : "multi-value-not-expanded",
    );
    return;
  }
  const parsed = parsePxLength(text);
  if (parsed === null) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  if ("relative" in parsed) {
    recordUnresolved(state, ref, property, rawValue, "relative-unit");
    return;
  }
  if (!allowNegative && parsed.px < 0) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  const formatted = formatCssNumber(parsed.px);
  if (formatted === null) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  const value = `${formatted}px`;
  recordToken(map, value, value, ref);
  state.used += 1;
}

function handleShadow(state: ExtractorState, ref: string, property: string, rawValue: string): void {
  const text = rawValue.trim();
  if (text.length === 0) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  if (text.toLowerCase() === "none") {
    recordToken(state.shadows, "none", "none", ref);
    state.used += 1;
    return;
  }
  const parts = splitTopLevelCommas(text);
  if (parts === null) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  if (parts.length > MAX_SHADOW_PARTS) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  let promoted = false;
  for (const part of parts) {
    const value = normalizeWhitespace(part).toLowerCase();
    if (value.length === 0 || value === "none") {
      recordUnresolved(state, ref, property, rawValue, "invalid-value");
      return;
    }
    recordToken(state.shadows, value, value, ref);
    promoted = true;
  }
  if (promoted) state.used += 1;
}

function handleDuration(state: ExtractorState, ref: string, property: string, rawValue: string): void {
  const text = rawValue.trim();
  if (containsMathFunction(text)) {
    recordUnresolved(state, ref, property, rawValue, "unsupported-syntax");
    return;
  }
  if (text.length === 0 || /[\s,]/.test(text)) {
    recordUnresolved(
      state,
      ref,
      property,
      rawValue,
      text.length === 0 ? "invalid-value" : "multi-value-not-expanded",
    );
    return;
  }
  if (text === "0") {
    recordToken(state.durations, "0ms", "0ms", ref);
    state.used += 1;
    return;
  }
  const match = /^(\d*\.?\d+)(ms|s)$/i.exec(text);
  if (match === null) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  const ms = match[2]?.toLowerCase() === "s" ? amount * 1000 : amount;
  const formatted = formatCssNumber(ms);
  if (formatted === null) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  const value = `${formatted}ms`;
  recordToken(state.durations, value, value, ref);
  state.used += 1;
}

function handleEasing(state: ExtractorState, ref: string, property: string, rawValue: string): void {
  const text = normalizeWhitespace(rawValue).toLowerCase();
  if (text.length === 0) {
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  if (EASING_KEYWORDS.has(text)) {
    recordToken(state.easings, text, text, ref);
    state.used += 1;
    return;
  }
  const bezier = /^cubic-bezier\(([^()]*)\)$/.exec(text);
  if (bezier !== null) {
    const args = (bezier[1] as string).split(",").map((arg) => arg.trim());
    // CSS numbers are decimal only: reject hex/exponent forms Number()
    // would otherwise accept, then enforce the x1/x2 unit range.
    const decimal = /^[+-]?(\d+\.?\d*|\.\d+)$/;
    const numbers = args.map((arg) => (decimal.test(arg) ? Number(arg) : Number.NaN));
    const inRange =
      numbers.length === 4 &&
      numbers.every((n) => Number.isFinite(n)) &&
      (numbers[0] as number) >= 0 &&
      (numbers[0] as number) <= 1 &&
      (numbers[2] as number) >= 0 &&
      (numbers[2] as number) <= 1;
    if (inRange) {
      recordToken(state.easings, text, text, ref);
      state.used += 1;
      return;
    }
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  const steps = /^steps\(([^()]*)\)$/.exec(text);
  if (steps !== null) {
    const args = (steps[1] as string).split(",").map((arg) => arg.trim().toLowerCase());
    const countText = args[0] as string;
    const decimal = /^[+]?(\d+)$/;
    const count = decimal.test(countText) ? Number(countText) : Number.NaN;
    const formatted = formatCssNumber(count);
    const jump = args.length === 1 ? "end" : args[1];
    const jumps = new Set(["start", "end", "jump-start", "jump-end", "jump-none", "jump-both"]);
    if (
      args.length <= 2 &&
      formatted !== null &&
      Number.isSafeInteger(count) &&
      count >= 1 &&
      jump !== undefined &&
      jumps.has(jump)
    ) {
      const value = args.length === 1 ? `steps(${formatted})` : `steps(${formatted}, ${jump})`;
      recordToken(state.easings, value, value, ref);
      state.used += 1;
      return;
    }
    recordUnresolved(state, ref, property, rawValue, "invalid-value");
    return;
  }
  if (text.includes(",")) {
    const parts = splitTopLevelCommas(text);
    if (parts === null || parts.some((part) => normalizeWhitespace(part).length === 0)) {
      recordUnresolved(state, ref, property, rawValue, "invalid-value");
      return;
    }
    recordUnresolved(state, ref, property, rawValue, "multi-value-not-expanded");
    return;
  }
  recordUnresolved(state, ref, property, rawValue, "invalid-value");
}

/**
 * Extract deterministic design tokens from style declarations.
 * Pure and offline: no network, no clock, no randomness. Throws
 * TokenError when the batch itself is malformed or exceeds the
 * declaration budget; per-value problems become `unresolved` entries.
 */
export function extractDesignTokens(declarations: StyleDeclaration[]): DesignTokens {
  if (!Array.isArray(declarations)) throw new TokenError("Declarations must be an array.");
  if (declarations.length > MAX_DECLARATIONS) {
    throw new TokenError(`Declaration budget exceeded (${String(declarations.length)}).`);
  }
  const state: ExtractorState = {
    colors: new Map(),
    families: new Map(),
    sizes: new Map(),
    weights: new Map(),
    lineHeights: new Map(),
    spacing: new Map(),
    radius: new Map(),
    shadows: new Map(),
    durations: new Map(),
    easings: new Map(),
    unresolved: [],
    unresolvedTruncated: false,
    propertiesSeen: new Set(),
    refsSeen: new Set(),
    used: 0,
  };
  declarations.forEach((declaration, index) => {
    if (typeof declaration !== "object" || declaration === null) {
      throw new TokenError(`Declaration at index ${String(index)} is not an object.`);
    }
    const { ref, property, value } = declaration;
    if (typeof ref !== "string" || typeof property !== "string" || typeof value !== "string") {
      throw new TokenError(`Declaration at index ${String(index)} has non-string fields.`);
    }
    if (ref.length === 0 || ref.length > MAX_REF_CHARS) {
      throw new TokenError(`Declaration at index ${String(index)} has an invalid ref.`);
    }
    const normalizedProperty = property.trim().toLowerCase();
    if (normalizedProperty.length === 0) {
      recordUnresolved(state, ref, "(unknown)", value, "invalid-value");
      return;
    }
    if (normalizedProperty.length > MAX_PROPERTY_CHARS) {
      recordUnresolved(state, ref, "(unknown)", value, "invalid-value");
      return;
    }
    state.propertiesSeen.add(normalizedProperty);
    state.refsSeen.add(ref);
    if (value.length > MAX_VALUE_CHARS) {
      recordUnresolved(state, ref, normalizedProperty, value, "value-too-long");
      return;
    }
    if (COLOR_PROPERTIES.has(normalizedProperty)) {
      handleColor(state, ref, normalizedProperty, value);
      return;
    }
    if (normalizedProperty === "font-family") {
      handleFontFamily(state, ref, normalizedProperty, value);
      return;
    }
    if (normalizedProperty === "font-size") {
      handleFontSize(state, ref, normalizedProperty, value);
      return;
    }
    if (normalizedProperty === "font-weight") {
      handleFontWeight(state, ref, normalizedProperty, value);
      return;
    }
    if (normalizedProperty === "line-height") {
      handleLineHeight(state, ref, normalizedProperty, value);
      return;
    }
    if (SPACING_PROPERTIES.has(normalizedProperty)) {
      // Only margins accept negative lengths per CSS; negative padding or
      // gaps are invalid and must never become tokens.
      handleAbsoluteLength(
        state,
        state.spacing,
        ref,
        normalizedProperty,
        value,
        normalizedProperty.startsWith("margin-"),
      );
      return;
    }
    if (RADIUS_LONGHANDS.has(normalizedProperty)) {
      handleAbsoluteLength(state, state.radius, ref, normalizedProperty, value, false);
      return;
    }
    if (normalizedProperty === "border-radius") {
      handleAbsoluteLength(state, state.radius, ref, normalizedProperty, value, false);
      return;
    }
    if (normalizedProperty === "box-shadow" || normalizedProperty === "text-shadow") {
      handleShadow(state, ref, normalizedProperty, value);
      return;
    }
    if (normalizedProperty === "transition-duration" || normalizedProperty === "animation-duration") {
      handleDuration(state, ref, normalizedProperty, value);
      return;
    }
    if (
      normalizedProperty === "transition-timing-function" ||
      normalizedProperty === "animation-timing-function"
    ) {
      handleEasing(state, ref, normalizedProperty, value);
      return;
    }
    if (
      normalizedProperty === "background" ||
      normalizedProperty === "border" ||
      normalizedProperty === "font" ||
      normalizedProperty === "transition" ||
      normalizedProperty === "animation"
    ) {
      recordUnresolved(state, ref, normalizedProperty, value, "shorthand-not-expanded");
      return;
    }
  });

  const colors = finalizeAccumulator(state.colors);
  const families = finalizeAccumulator(state.families);
  const sizes = finalizeAccumulator(state.sizes);
  const weights = finalizeAccumulator(state.weights);
  const lineHeights = finalizeAccumulator(state.lineHeights);
  const spacing = finalizeAccumulator(state.spacing);
  const radius = finalizeAccumulator(state.radius);
  const shadows = finalizeAccumulator(state.shadows);
  const durations = finalizeAccumulator(state.durations);
  const easings = finalizeAccumulator(state.easings);

  const observed: string[] = [];
  if (colors.length > 0) observed.push("color");
  if (families.length > 0) observed.push("typography.family");
  if (sizes.length > 0) observed.push("typography.size");
  if (weights.length > 0) observed.push("typography.weight");
  if (lineHeights.length > 0) observed.push("typography.line-height");
  if (spacing.length > 0) observed.push("spacing");
  if (radius.length > 0) observed.push("radius");
  if (shadows.length > 0) observed.push("shadow");
  if (durations.length > 0) observed.push("motion.duration");
  if (easings.length > 0) observed.push("motion.easing");

  const coverage: TokenCoverage = {
    declarationsSeen: declarations.length,
    declarationsUsed: state.used,
    refsSeen: state.refsSeen.size,
    propertiesSeen: [...state.propertiesSeen].sort(),
  };
  const provenance: TokenProvenance = { observed, inferred: [] };
  const isEmpty =
    colors.length === 0 &&
    families.length === 0 &&
    sizes.length === 0 &&
    weights.length === 0 &&
    lineHeights.length === 0 &&
    spacing.length === 0 &&
    radius.length === 0 &&
    shadows.length === 0 &&
    durations.length === 0 &&
    easings.length === 0;

  const canonical = {
    version: 1 as const,
    colors,
    typography: { families, sizes, weights, lineHeights },
    spacing,
    radius,
    shadows,
    motion: { durations, easings },
    unresolved: sortUnresolved(state.unresolved),
    unresolvedTruncated: state.unresolvedTruncated,
    coverage,
    provenance,
    isEmpty,
  };
  const fingerprint = fingerprintPayload(JSON.stringify(canonical));
  return { ...canonical, fingerprint };
}
