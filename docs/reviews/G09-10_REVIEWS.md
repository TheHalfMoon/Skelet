# G09-10 — Lens Export Surface

Base: `e12c4e0dd35c921a84af0d0123c57bfcb59e8d98`.
Branch: `skelet/p09-g09-10-lens-export`.
Status: IMPLEMENTED, qualified locally; exact-head CI and merge pending.

## Intent and implemented scope

- New pure module `packages/lens/src/export-surface.ts`: a deterministic,
  offline, dependency-free projection of an assembled `LensReport`
  (G09-08 assembly, G09-09 source-linked evidence) into seven
  byte-reproducible artifacts — `lens.json` (canonical report bytes),
  `DESIGN.md` (structured design record), `tokens.dtcg.json` (DTCG
  2025.10, re-validated against a pinned offline subset before emission),
  `tailwind.theme.js` (CommonJS theme, qualified values only),
  `shadcn-theme.css` (indexed observed variables, no semantic role
  inference), `AGENT.md` (Agent Context Pack), and `manifest.json`
  (sorted hashes, coverage, exclusions, rights, unsupported features).
- Boundaries: font-family and shadow observations stay data-only and are
  excluded from executable themes; theme emission re-validates strict
  grammars independently and records refusals instead of converting
  silently; non-empty `unknown` slots and non-empty
  heuristic/modelGenerated provenance fail closed; unknown-rights assets
  are never embedded and appear only as inert code spans; all untrusted
  text is HTML/Markdown-escaped; artifact paths are fixed constants and
  the module performs no filesystem writes. Reports stay explicitly
  `partial`; no full-site reproduction is claimed.
- Tests: new `export-surface.test.mjs` (11 tests: byte-determinism,
  qualified export per category, exclusions/coverage preservation,
  executable-CSS refusal, inert Markdown, asset exclusion, real
  parser/build verification via `node --check` plus `require` round-trip
  and strict CSS structural parse, manifest accuracy, theme-boundary
  refusals, fail-closed negatives including malformed token payloads,
  empty-partial themes).
- CI lens job lists the new test file (+1 line, no other workflow change).

## Evidence

- Lens Node tests: 85/85 PASS (74 prior + 11 new).
- Python bootstrap: 131/131 PASS.
- Strict Lens TypeScript + ESLint: PASS.
- Upstream validation: 30 sources PASS; skills 4 PASS.
- Graft build/check: PASS; blast isolated to the lens package (one new
  module, one new test, one CI line; no existing source modified; no
  downstream consumers; no dependency added).
- Jev genuine `jev-1.13.0`: see `G09-10_JEV_SPEC.json` and
  `G09-10_JEV_REVIEW.json`. Probabilities for a problem:
  correctness 0.13, security 0.09, evidence 0.54,
  reliability 0.22, scope 0.20, compatibility 0.21.
  Scores are uncertainty indicators, not a substitute for tests or review.
  Evidence is highest; the theme-boundary refusal probe and the
  token-structure regression tests are the targeted answers (precedent:
  Issue #34 notes these meters sit high regardless of coverage and the
  diff-reading PStack panel carries the gate).
- Alibaba OCR v1.12.13: official delegation rules applied to the exact
  diff across all three resolved rule groups; panel record is
  `unsupported_ext` and excluded by OCR itself. Zero blocking findings;
  no independent model-backed OCR scan claimed. See
  `G09-10_OCR_DELEGATION.md`.
- PStack: fresh-context initial panel found one must-fix (M1: malformed
  token payloads raised `TypeError` instead of the documented fail-closed
  `ExportError`) plus one accepted advisory (A1: multi-line raw values
  can break Markdown table layout but stay inert). M1 fixed structurally
  with regression tests; independent delta review verified the closure
  with no new defects and all four bars PASS. See
  `G09-10_PSTACK_PANELS.md`.
- TesterArmy E2E: not executed as a browser journey; this grain exposes
  no new route/job/UI/MCP journey. The user-facing-equivalent proof is
  genuine: generated `tailwind.theme.js` artifacts pass the real Node
  parser (`node --check`) plus a `require` build round-trip inside the
  committed tests, and every theme/manifest combination is covered by
  integration tests over assembled reports. TesterArmy remains scheduled
  for P09b user-facing workflows and the full P09b lifecycle E2E.

## Explicit remaining work and limitations

- G09-10 is the export surface only, **not** the full P09 URL-to-report
  acceptance journey. Evidence-based technology clues, optional provider
  outputs, the Lens report API, user-facing integration, the malicious
  URL and private-network rejection corpus beyond the existing guards,
  and production isolation requirements remain future grains. No
  successful empty analysis or full-site reproduction is claimed.
- Observed page text is hostile data; downstream renderers/agents must
  preserve the data-vs-instruction trust boundary (restated in every
  human-facing artifact).
- The DTCG offline validator covers the emitted color/dimension subset,
  not the full DTCG specification; shadcn output is indexed observed
  variables, not a semantic theme mapping.
- This commit remains subject to exact-head CI before normal merge,
  followed by post-merge verification.
