# G09-08 — Deterministic Lens Design DNA Report Core

Base: `79d5ad38e8119ee568c20dc7da3b1446876eed0e`.
Branch: `skelet/p09-g09-08-design-dna-report-core`.
Status: IMPLEMENTED, PStack fresh-context delta PASS; exact-head CI and merge pending.

## Intent and implemented scope

- Pure local `assembleLensReport(capture, declarations)` projects qualified
  capture evidence and an injected style-declaration corpus into a versioned,
  explicit **partial** Lens report. No URL fetch, provider invocation, UI,
  database, or artificial technology/component/QA clues are introduced.
- URLs and JPEG evidence are capped, checked, and hashed; a bounded JPEG
  frame/scan marker parser rejects malformed framing and image dimensions
  beyond 4096 pixels per side / 16 million pixels; it is not a full entropy
  decoder. The tests use a real Playwright-generated JPEG fixture.
  Required upstream capture coverage markers must be present. Asset hrefs remain
  references with rights `unknown` and `downloadable: false`, never binary
  exports. Title, sections, and screenshot remain observed, not interpreted.
- Existing `extractDesignTokens` powers the Design DNA subset; unresolved
  properties are preserved. A SHA-256 analysis identity binds full token
  content, source digest, screenshot digest, sections, links, and coverage.
- DTCG 2025.10 export includes only validated sRGB colors and numeric
  pixel dimensions. Unsafe shadow and font-family strings never enter that
  code-reemittable export; they remain untrusted, observed token data.
  Relevant standards: https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/
  and https://www.w3.org/community/reports/design-tokens/CG-FINAL-color-20251028/
- Unknown providers and missing qualified styles are explicit coverage gaps;
  an empty token set never qualifies a complete report.

## Evidence

- Lens Node tests: 64/64 PASS (15 new deterministic/security report tests).
- Python bootstrap: 131/131 PASS.
- Strict Lens TypeScript + ESLint: PASS.
- Upstream validation: 30 sources PASS.
- Graft build/check: PASS, 930 indexed nodes; blast isolated with no
  indexed downstream dependents. No dependency added.
- Jev genuine `jev-1.13.0`: see `G09-08_JEV_SPEC.json` and
  `G09-08_JEV_REVIEW.json`. Probabilities for a problem:
  correctness 0.22, security 0.24, evidence 0.36,
  reliability 0.46, scope 0.43, compatibility 0.42.
  Scores are uncertainty indicators, not a substitute for tests or review.
- Alibaba OCR v1.12.13: official delegation preview/rules applied to TS and
  workflow changes; no independent model-backed OCR scan is claimed.
- PStack fresh-context judge initial verdict: FAIL, four must-fix:
  malformed/oversized JPEG, incomplete analysis ID hash coverage, omitted
  negative margin dimensions, and unqualified offline provenance assertion.
  Repaired structurally, with regression tests and corrected provenance
  wording. Sparse-array and aggregate style-budget advisories also fixed.
  The first delta review verified those closures but identified unsupported
  SOF3/SOF5–7/SOF9–11/SOF13–15 markers being skipped. All such frame markers
  now fail closed with an adversarial multi-SOF regression test. A second
  delta review exposed DHP (FFDE) hierarchical dimensions; the JPEG marker
  parser now uses an explicit allowlist for Chromium-compatible DCT frames
  and supporting segments, rejecting unsupported frame controls by default.
  Jev
  probabilities in this record were synchronized with the genuine rerun.
  Final independent fresh-context delta review: all four PStack bars PASS,
  no unresolved must-fix, cleared for exact-head CI qualification.
  Reviewer files are preserved in G09-08_PSTACK_PANELS.md.
- TesterArmy E2E: not executed; this grain exposes no new route/job/UI/MCP
  journey. The new Node tests validate the pure interface. TesterArmy's
  integration remains scheduled for P09b user-facing job workflows.

## Explicit remaining work and limitations

- G09-08 is an offline report core, **not** the full P09 URL-to-report
  acceptance journey. A later grain must gather source-linked style
  declarations, wire the capture/report pipeline, and qualify provenance.
- Full DESIGN.md, Tailwind, shadcn and agent-context exports, technology
  detection, rights verification, QA providers and production OS sandboxing
  remain future work. No successful empty analysis or full-site
  reproduction is claimed.
- Observed page text is hostile data; downstream renderers/agents must
  preserve the data-vs-instruction trust boundary and escape output.
- JPEG marker/dimension validation is not a complete entropy/image decode.
  Downstream image views must handle decoder failures and pixel dimensions
  defensively; the capture worker itself emits Chromium-encoded JPEGs.
- First exact-head CI run for code SHA `15fd658` had the Lens job pass
  but bootstrap fail because copied PStack findings contained broken
  relative Markdown links. The panel record links have been normalized
  to code-formatted file anchors and locally rechecked with ci_hygiene.py.
  This is a documentation/hygiene correction, not a code change.
- This commit remains subject to mandatory independent review and
  exact-head CI before normal merge, followed by post-merge verification.
