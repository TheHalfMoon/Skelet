import assert from "node:assert/strict";
import test from "node:test";

import {
  TOKEN_LIMITS,
  TokenError,
  extractDesignTokens,
} from "../src/design-tokens.ts";

function decl(ref, property, value) {
  return { ref, property, value };
}

function tokenValues(tokens) {
  return tokens.map((entry) => entry.value);
}

test("hex colors normalize to lowercase with alpha preserved", () => {
  const tokens = extractDesignTokens([
    decl("a", "color", "#FFF"),
    decl("b", "background-color", "#ff000080"),
    decl("c", "border-color", "#FfF8"),
    decl("d", "color", "#123456"),
  ]);
  assert.deepEqual(tokenValues(tokens.colors), ["#123456", "#ff000080", "#ffffff", "#ffffff88"]);
});

test("transparent maps to zero alpha black", () => {
  const tokens = extractDesignTokens([decl("a", "color", "transparent")]);
  assert.deepEqual(tokenValues(tokens.colors), ["#00000000"]);
});

test("rgb parses comma, space, slash, percentage, and none forms", () => {
  const tokens = extractDesignTokens([
    decl("a", "color", "rgb(255, 0, 0)"),
    decl("b", "color", "rgb(255 0 0)"),
    decl("c", "color", "rgba(0, 128, 0, 0.5)"),
    decl("d", "color", "rgb(0 0 255 / 50%)"),
    decl("e", "color", "rgb(100% 0% 0%)"),
    decl("f", "color", "rgb(none none 255)"),
  ]);
  assert.deepEqual(tokenValues(tokens.colors), [
    "#ff0000",
    "#0000ff",
    "#0000ff80",
    "#00800080",
  ]);
});

test("hsl converts with alpha and turn units", () => {
  const tokens = extractDesignTokens([
    decl("a", "color", "hsl(0, 100%, 50%)"),
    decl("b", "color", "hsl(120deg 100% 25%)"),
    decl("c", "color", "hsla(0.5turn, 100%, 50%, 0.25)"),
  ]);
  assert.deepEqual(tokenValues(tokens.colors), ["#008000", "#00ffff40", "#ff0000"]);
});

test("named colors resolve including rebeccapurple", () => {
  const tokens = extractDesignTokens([
    decl("a", "color", "rebeccapurple"),
    decl("b", "color", "RED"),
  ]);
  assert.deepEqual(tokenValues(tokens.colors), ["#663399", "#ff0000"]);
});

test("references, context keywords, and unsupported functions stay unresolved", () => {
  const tokens = extractDesignTokens([
    decl("a", "color", "var(--brand)"),
    decl("b", "color", "currentcolor"),
    decl("c", "color", "inherit"),
    decl("d", "color", "color-mix(in srgb, red 50%, blue)"),
    decl("e", "color", "lab(50% 40 59.5)"),
    decl("f", "color", "not-a-color"),
    decl("g", "color", "#12"),
  ]);
  assert.equal(tokens.colors.length, 0);
  const reasons = Object.fromEntries(tokens.unresolved.map((entry) => [entry.ref, entry.reason]));
  assert.deepEqual(reasons, {
    a: "unresolved-reference",
    b: "context-dependent",
    c: "context-dependent",
    d: "unsupported-syntax",
    e: "unsupported-syntax",
    f: "invalid-value",
    g: "invalid-value",
  });
});

test("font-family stacks normalize quotes with case-insensitive dedupe", () => {
  const tokens = extractDesignTokens([
    decl("a", "font-family", '"Inter", system-ui, sans-serif'),
    decl("b", "font-family", "inter, SYSTEM-UI, Sans-Serif"),
    decl("c", "font-family", "Georgia, serif"),
  ]);
  assert.deepEqual(tokenValues(tokens.typography.families), [
    "Inter, system-ui, sans-serif",
    "Georgia, serif",
  ]);
  assert.equal(tokens.typography.families[0]?.occurrences, 2);
  assert.deepEqual(tokens.typography.families[0]?.refs, ["a", "b"]);
});

test("font-size promotes absolute px only", () => {
  const tokens = extractDesignTokens([
    decl("a", "font-size", "16px"),
    decl("b", "font-size", "16.0px"),
    decl("c", "font-size", "0"),
    decl("d", "font-size", "1rem"),
    decl("e", "font-size", "100%"),
    decl("f", "font-size", "medium"),
    decl("g", "font-size", "-4px"),
  ]);
  assert.deepEqual(tokenValues(tokens.typography.sizes), ["16px", "0px"]);
  const reasons = Object.fromEntries(tokens.unresolved.map((entry) => [entry.ref, entry.reason]));
  assert.deepEqual(reasons, {
    d: "relative-unit",
    e: "relative-unit",
    f: "invalid-value",
    g: "invalid-value",
  });
});

test("font-weight maps keywords and validates numerics", () => {
  const tokens = extractDesignTokens([
    decl("a", "font-weight", "normal"),
    decl("b", "font-weight", "BOLD"),
    decl("c", "font-weight", "600"),
    decl("d", "font-weight", "bolder"),
    decl("e", "font-weight", "heavy"),
  ]);
  assert.deepEqual(tokenValues(tokens.typography.weights), ["400", "600", "700"]);
  const reasons = Object.fromEntries(tokens.unresolved.map((entry) => [entry.ref, entry.reason]));
  assert.deepEqual(reasons, { d: "context-dependent", e: "invalid-value" });
});

test("line-height accepts normal, unitless, and px but not percent", () => {
  const tokens = extractDesignTokens([
    decl("a", "line-height", "normal"),
    decl("b", "line-height", "1.5"),
    decl("c", "line-height", "24px"),
    decl("d", "line-height", "150%"),
    decl("e", "line-height", "-1"),
  ]);
  assert.deepEqual(tokenValues(tokens.typography.lineHeights), ["1.5", "24px", "normal"]);
  const reasons = Object.fromEntries(tokens.unresolved.map((entry) => [entry.ref, entry.reason]));
  assert.deepEqual(reasons, { d: "relative-unit", e: "invalid-value" });
});

test("spacing accepts single absolute lengths including negatives", () => {
  const tokens = extractDesignTokens([
    decl("a", "margin-top", "8px"),
    decl("b", "padding-left", "-4px"),
    decl("c", "gap", "0"),
    decl("d", "margin-top", "10px 20px"),
    decl("e", "padding-top", "1em"),
  ]);
  assert.deepEqual(tokenValues(tokens.spacing), ["-4px", "0px", "8px"]);
  const reasons = Object.fromEntries(tokens.unresolved.map((entry) => [entry.ref, entry.reason]));
  assert.deepEqual(reasons, { d: "multi-value-not-expanded", e: "relative-unit" });
});

test("radius accepts longhands and single border-radius only", () => {
  const tokens = extractDesignTokens([
    decl("a", "border-top-left-radius", "4px"),
    decl("b", "border-radius", "8px"),
    decl("c", "border-radius", "4px 8px"),
    decl("d", "border-bottom-right-radius", "50%"),
    decl("e", "border-top-right-radius", "-2px"),
  ]);
  assert.deepEqual(tokenValues(tokens.radius), ["4px", "8px"]);
  const reasons = Object.fromEntries(tokens.unresolved.map((entry) => [entry.ref, entry.reason]));
  assert.deepEqual(reasons, {
    c: "multi-value-not-expanded",
    d: "relative-unit",
    e: "invalid-value",
  });
});

test("shadows normalize none and split top-level lists", () => {
  const tokens = extractDesignTokens([
    decl("a", "box-shadow", "NONE"),
    decl("b", "box-shadow", "0  2px  8px  #00000040"),
    decl("c", "text-shadow", "1px 1px 0 #FFF, 0 0 4px rgba(0,0,0,0.5)"),
    decl("d", "box-shadow", ""),
  ]);
  assert.deepEqual(tokenValues(tokens.shadows), [
    "0 0 4px rgba(0,0,0,0.5)",
    "0 2px 8px #00000040",
    "1px 1px 0 #fff",
    "none",
  ]);
  assert.equal(tokens.unresolved[0]?.reason, "invalid-value");
});

test("durations normalize seconds to milliseconds", () => {
  const tokens = extractDesignTokens([
    decl("a", "transition-duration", "0.2s"),
    decl("b", "animation-duration", "200ms"),
    decl("c", "transition-duration", "0"),
    decl("d", "transition-duration", "0.2s, 0.4s"),
    decl("e", "transition-duration", "-1s"),
  ]);
  assert.deepEqual(tokenValues(tokens.motion.durations), ["200ms", "0ms"]);
  const reasons = Object.fromEntries(tokens.unresolved.map((entry) => [entry.ref, entry.reason]));
  assert.deepEqual(reasons, { d: "multi-value-not-expanded", e: "invalid-value" });
});

test("easings accept keywords and validated functions", () => {
  const tokens = extractDesignTokens([
    decl("a", "transition-timing-function", "EASE-IN-OUT"),
    decl("b", "animation-timing-function", "cubic-bezier(0.4, 0, 0.2, 1)"),
    decl("c", "transition-timing-function", "steps(2, jump-none)"),
    decl("d", "transition-timing-function", "ease, linear"),
    decl("e", "transition-timing-function", "wiggle"),
    decl("f", "transition-timing-function", "cubic-bezier(1, 2)"),
  ]);
  assert.deepEqual(tokenValues(tokens.motion.easings), [
    "cubic-bezier(0.4, 0, 0.2, 1)",
    "ease-in-out",
    "steps(2, jump-none)",
  ]);
  const reasons = Object.fromEntries(tokens.unresolved.map((entry) => [entry.ref, entry.reason]));
  assert.deepEqual(reasons, { d: "multi-value-not-expanded", e: "invalid-value", f: "invalid-value" });
});

test("shorthands and unknown properties never fabricate tokens", () => {
  const tokens = extractDesignTokens([
    decl("a", "background", "#fff"),
    decl("b", "border", "1px solid red"),
    decl("c", "font", "16px Inter"),
    decl("d", "display", "grid"),
  ]);
  assert.equal(tokens.isEmpty, true);
  const reasons = Object.fromEntries(tokens.unresolved.map((entry) => [entry.ref, entry.reason]));
  assert.deepEqual(reasons, {
    a: "shorthand-not-expanded",
    b: "shorthand-not-expanded",
    c: "shorthand-not-expanded",
  });
  assert.deepEqual(tokens.coverage.propertiesSeen, ["background", "border", "display", "font"]);
});

test("output is deterministic under shuffled input", () => {
  const base = [
    decl("r1", "color", "hsl(240, 100%, 50%)"),
    decl("r2", "margin-top", "8px"),
    decl("r3", "font-family", '"Inter", sans-serif'),
    decl("r4", "color", "#0000ff"),
    decl("r5", "box-shadow", "0 1px 2px #000"),
    decl("r6", "font-size", "2rem"),
    decl("r7", "transition-duration", "150ms"),
  ];
  const first = JSON.stringify(extractDesignTokens(base));
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const shuffled = [...base];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const current = shuffled[i];
    const other = shuffled[j];
    if (current !== undefined && other !== undefined) {
      shuffled[i] = other;
      shuffled[j] = current;
    }
  }
  const second = JSON.stringify(extractDesignTokens(shuffled));
  assert.equal(first, second);
  const tokens = extractDesignTokens(base);
  assert.equal(tokens.fingerprint, extractDesignTokens(base).fingerprint);
  assert.equal(tokens.fingerprint.length, 28);
});

test("empty input yields an honest empty result with no inference", () => {
  const tokens = extractDesignTokens([]);
  assert.equal(tokens.isEmpty, true);
  assert.deepEqual(tokens.provenance, { observed: [], inferred: [] });
  assert.deepEqual(tokens.coverage, {
    declarationsSeen: 0,
    declarationsUsed: 0,
    refsSeen: 0,
    propertiesSeen: [],
  });
  assert.equal(tokens.unresolved.length, 0);
});

test("coverage counts and provenance reflect real promotion", () => {
  const tokens = extractDesignTokens([
    decl("a", "color", "red"),
    decl("b", "color", "red"),
    decl("c", "font-size", "1rem"),
    decl("d", "display", "grid"),
  ]);
  assert.deepEqual(tokens.coverage, {
    declarationsSeen: 4,
    declarationsUsed: 2,
    refsSeen: 4,
    propertiesSeen: ["color", "display", "font-size"],
  });
  assert.deepEqual(tokens.provenance, { observed: ["color"], inferred: [] });
  assert.equal(tokens.colors[0]?.occurrences, 2);
  assert.deepEqual(tokens.colors[0]?.refs, ["a", "b"]);
});

test("batch budget and malformed entries fail closed", () => {
  const oversized = Array.from({ length: TOKEN_LIMITS.maxDeclarations + 1 }, (_, i) =>
    decl(`r${String(i)}`, "color", "red"),
  );
  assert.throws(() => extractDesignTokens(oversized), TokenError);
  assert.throws(() => extractDesignTokens("nope"), TokenError);
  assert.throws(() => extractDesignTokens([null]), TokenError);
  assert.throws(() => extractDesignTokens([{ ref: "", property: "color", value: "red" }]), TokenError);
});

test("oversize values become bounded unresolved entries", () => {
  const tokens = extractDesignTokens([decl("a", "color", `rgb(${"1,".repeat(1100)}1)`)]);
  assert.equal(tokens.colors.length, 0);
  assert.equal(tokens.unresolved[0]?.reason, "value-too-long");
  assert.ok((tokens.unresolved[0]?.value.length ?? 0) <= 128);
});

test("unresolved list truncates with an honest flag", () => {
  const declarations = Array.from({ length: TOKEN_LIMITS.maxUnresolved + 5 }, (_, i) =>
    decl(`r${String(i)}`, "color", "not-a-color"),
  );
  const tokens = extractDesignTokens(declarations);
  assert.equal(tokens.unresolved.length, TOKEN_LIMITS.maxUnresolved);
  assert.equal(tokens.unresolvedTruncated, true);
});
