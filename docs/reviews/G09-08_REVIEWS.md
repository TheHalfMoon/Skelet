# G09-08 — Deterministic Lens Design DNA Report Core

Base: `79d5ad38e8119ee568c20dc7da3b1446876eed0e`.
Branch: `skelet/p09-g09-08-design-dna-report-core`.
Status: IMPLEMENTED; independent PStack verdict, exact-head CI, and merge pending.

## Intent and implemented scope

- Pure local `assembleLensReport(capture, declarations)` projects qualified
  capture evidence and an injected style-declaration corpus into a versioned,
  explicit **partial** Lens report. No URL fetch, provider invocation, UI,
  database, or artificial technology/component/QA clues are introduced.
- URLs and JPEG evidence are capped, checked, and hashed; asset hrefs remain
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

- Lens Node tests: 57/57 PASS (seven new deterministic report tests).
- Python bootstrap: 131/131 PASS.
- Strict Lens TypeScript + ESLint: PASS.
- Upstream validation: 30 sources PASS.
- Graft build/check: PASS, 927 indexed nodes. No dependency added.
- Jev genuine `jev-1.13.0`: see `G09-08_JEV_SPEC.json` and
  `G09-08_JEV_REVIEW.json`. Probabilities for a problem:
  correctness 0.15, security 0.11, evidence 0.40,
  reliability 0.33, scope 0.28, compatibility 0.34.
  Scores are uncertainty indicators, not a substitute for tests or review.
- Alibaba OCR v1.12.13: official delegation preview/rules applied to TS and
  workflow changes; no independent model-backed OCR scan is claimed.
- PStack: fresh-context independent judge requested on diff; record verdict
  only after actual output is received. Not considered PASS by default.
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
- This commit remains subject to mandatory independent review and
  exact-head CI before normal merge, followed by post-merge verification.
