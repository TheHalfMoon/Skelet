# G09-11 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context read-only sessions over the full
`tech-signal-evidence.ts` implementation, the capture-child extraction,
the worker IPC gate, the report/export wiring, and the 13-test suite.
Specialized agent providers unavailable: the judges used inline bars, not
four independent provider models. This record MUST NOT be described as
four independent provider models.

## Initial fresh-context panel

Review basis: base `751b8fd…` through the working tree, including the new
signal module, capture wiring, contract extensions, the 11-test suite,
and the CI delta. No files were edited by the reviewer. Targeted runs at
review time: tech-signal 11/11, full lens 96/96, typecheck clean, lint
clean, Python bootstrap 131/131, upstreams 30, skills 4.

## Must-fix

- **M1 — Candidate slice drops lost observations without a flag.**
  `meta[name]`, `script[src]`, and `link[rel][href]` collections were
  sliced to per-kind caps before filtering, so a page with 105 scripts
  (or 40 generator metas) silently lost the overflow with
  `techTruncated === false`. FIXED structurally: generator metas are
  pre-filtered then overflow-checked, scripts overflow-check the full
  list before slicing, and links iterate the full list under the existing
  per-kind caps (which already flag). New Chromium regression test pins
  the 105-script case (100 kept, flag set, total within budget).
- **M2 — `data-*` name grammar could overflow the detail budget.**
  The page regex admitted 63-char names, but `attr:<name>` must fit
  `maxDetailChars` (64): a 60-char name would have failed the whole
  capture closed on a legitimate page. FIXED structurally: names longer
  than 59 chars skip with `techTruncated = true` (honest exclusion, no
  capture failure); other out-of-contract names skip silently as
  non-evidence. New Chromium regression test pins the overlong-name case
  (flag set, capture succeeds, short names still collected).

## Worth considering (two accepted)

- **A1 — `|` inside observed values can split a DESIGN.md table row.**
  Signal values travel inside backtick code spans with HTML escaping, so
  content stays inert (no markup, link, or code breakout — covered by the
  hostile-payload test), but a literal pipe renders a visual row split in
  some Markdown table parsers. ACCEPTED as view-only cosmetic: `lens.json`
  remains the verbatim canonical record and nothing is dropped. Same
  disposition as the G09-10 A1 precedent.
- **A2 — Chained comparison ternaries in sort comparators.**
  The kind/value/ref/detail ordering uses a chained ternary, matching the
  established codebase sort idiom (G09-08 asset sort, export manifest
  sort) and passing repo ESLint. ACCEPTED as idiom-consistent.

## Four-bar verdicts

- **Correctness: PASS** — five kinds collect from the offline render with
  relative-URL resolution, exact-dupe collapse, deterministic ordering,
  and honest truncation flags; report/export contracts extend additively
  (`observed.techSignals`, inert Markdown, `technologyClues` still empty);
  analysisId remains a full-report digest.
- **Parsimony: PASS** — one pure module reusing `elementRef`, shared
  `safeLink` semantics, and existing IPC/report/export gates; no new
  dependency, no consumer changes; the only workflow delta is the new
  test file listing.
- **Product: PASS** — observations only, never technology identities; no
  confidence scores; no crawler, no extra requests, no file bodies;
  unknown slots and heuristic/model provenance still fail closed; partial
  status and no-reproduction disclaimers travel into every artifact.
- **Security: PASS** — http(s)-only URL gate, fixed string/count budgets,
  single fail-closed error type (normalized from the shared ref builder),
  fixed object keys (no `__proto__` sink), sparse-array rejection at every
  gate, `data-*` values never collected, hostile payloads inert-tested.

## Delta (must-fix closure)

A second fresh-context session verified M1/M2 FIXED without new defects:
the 105-script and overlong-attribute Chromium cases are green, the valid
path is byte-identical for in-budget pages, and typecheck, lint, the full
lens suite (98/98), Python bootstrap, upstream, and skills checks remain
green. A1/A2 accepted as documented. Remaining must-fix: **None.**

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.
