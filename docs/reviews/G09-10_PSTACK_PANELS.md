# G09-10 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context independent read-only sessions over the full
`export-surface.ts` implementation and its tests. Specialized agent
providers unavailable: the judges used inline bars, not four independent
provider models.

## Initial fresh-context panel

Review basis: base `e12c4e0…` through the working tree, including the new
export module, its 10-test adversarial suite, and the CI delta. No files
were edited by the reviewer. Targeted runs at review time:
export-surface 10/10 (later 11/11), full lens 84/84 (later 85/85),
typecheck clean, lint clean.

## Must-fix

- **M1 — Malformed token payloads escaped the ExportError contract.**
  `assertExportableReport` verified `tokens` only as "a record", so a
  crafted report with a non-array `colors`, a mistyped table entry, or a
  wrong token `version` reached `collectThemeValues`/`tokenRows` and
  crashed with a raw `TypeError` instead of the documented fail-closed
  `ExportError`. No bad output was possible (fail-closed crash), but the
  error contract was violated. FIXED structurally: new
  `assertTokenStructure` validates the version marker, all ten token
  tables (element shapes: string value, safe-int occurrences, string[]
  refs), unresolved entries, truncation/empty flags, coverage, and token
  provenance before any projection. Three regression cases added to the
  fail-closed test (mistyped table entry, emptied typography, wrong
  version). Typecheck, lint, and all tests re-verified after the fix.

## Worth considering (one accepted)

- **A1 — Multi-line raw values can break Markdown table layout.**
  Unresolved declaration values are truncated raw strings; a value
  containing a newline would split its `DESIGN.md` table row across lines.
  ACCEPTED as view-only cosmetic: the content stays inert (no unescaped
  markup, links, or code breakout — covered by the hostile-payload tests),
  single-value computed tokens essentially never contain newlines, and
  `lens.json` remains the verbatim canonical record. No silent data loss:
  nothing is dropped or rewritten.

## Four-bar verdicts

- **Correctness: PASS** — seven artifacts byte-deterministic end to end;
  qualified colors, typography, spacing, radius, durations, and easings
  land in the correct Tailwind/shadcn/DTCG slots; unsupported values stay
  exclusions with refs; theme-boundary refusals are recorded, not silent;
  manifest hashes recompute exactly.
- **Parsimony: PASS** — one pure module, shared escapers/guards/builders,
  no duplicated token logic, no new dependency, no consumer changes; the
  only workflow delta is the new test file listing.
- **Product: PASS** — no fabricated brand, technology, component, or rights
  facts; unknown slots and model/heuristic provenance fail closed;
  partial status and no-reproduction disclaimers travel into every
  human-facing artifact; unknown-rights assets appear only as inert
  references.
- **Security: PASS** — font/shadow strings never reach executable files
  (adversarial-tested); Markdown/HTML contexts escape; theme emission
  re-validates grammars independently; artifact paths are constants;
  no filesystem writes, no network, no clock.

## Delta (must-fix closure)

A second fresh-context session verified M1 FIXED without new defects:
malformed token shapes now raise `ExportError` at the gate (three new
regression cases green), the valid path is byte-identical to before
(determinism test still passes against reversed input), and typecheck,
lint, the full lens suite, Python bootstrap, upstream, and skills checks
remain green. A1 accepted as documented. Remaining must-fix: **None.**

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.

panel: full — correctness ✓ inline · parsimony ✓ inline · product ✓ inline · security ✓ inline · deltas: mechanical tier
