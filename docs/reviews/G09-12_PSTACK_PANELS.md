# G09-12 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context read-only sessions over the matcher module,
the report/export wiring, and the 15-test suite. Specialized agent
providers unavailable: the judges used inline bars, not four independent
provider models. This record MUST NOT be described as four independent
provider models.

## Initial fresh-context panel

Review basis: base `50291b5…` through the working tree, including the new
matcher, contract evolution, and the 15-test suite. No files were edited
by the reviewer. Targeted runs at review time: tech-clue 15/15, full lens
113/113, typecheck clean, lint clean, Python bootstrap 131/131.

Two genuine defects were found by the committed tests during development
and fixed before this panel: path-token splitting on `_` destroyed the
`_next` token (fixed to full-segment equality), and an empty generator
value was expected to non-match instead of failing closed at the
evidence gate (test corrected to assert the fail-closed throw).

## Must-fix

- **None.** No remaining must-fix findings.

## Worth considering (two accepted)

- **A1 — `maxClues` overflow throw is currently unreachable.**
  Eight distinct technologies exist across ten rules, so the 20-clue cap
  cannot trigger today. ACCEPTED as a forward budget guard: any future
  rule-set growth stays bounded by construction.
- **A2 — `|` inside technology labels could split a DESIGN.md table row.**
  Clue fields travel inside backtick code spans with HTML escaping, so
  content stays inert (no markup, link, or code breakout — covered by the
  hostile-payload export test). ACCEPTED as view-only cosmetic with
  `lens.json` as the verbatim canonical record. Same disposition as the
  G09-10/G09-11 A1 precedents.

## Four-bar verdicts

- **Correctness: PASS** — ten rules match as calibrated (prefix-anchored
  generators, suffix-anchored hosts, segment-equal paths); same-technology
  hits merge at max confidence with sorted rules/refs; ranking is
  confidence-desc/technology-asc and input-order independent; unmatched
  input stays honestly empty with an explicit gap; report/export contracts
  evolve additively with full-suite proof.
- **Parsimony: PASS** — one pure module, no new dependency, no regex
  engine, no network, G05-02 conformance by structural mirror;
  report/export deltas are additive gates and rendering only.
- **Product: PASS** — observed-evidence/matched-rules/clues stay
  separated; every clue carries confidence below 1.0 with rule and
  evidence links; never-installations framing travels into reports,
  DESIGN.md, AGENT.md, and disclaimers; no GPL dataset, no crawler, no
  enrichment, no live probing.
- **Security: PASS** — http(s) URLs only from the validated evidence
  gate; fail-closed single error type; sparse-array rejection at every
  gate; fixed object keys; hostile payloads inert-tested; certainty
  laundering structurally impossible (confidence 1.0 rejected at two
  independent gates).

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.
