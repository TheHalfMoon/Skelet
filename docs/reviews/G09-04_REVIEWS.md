# G09-04 Dembrandt Evaluation and Verified Pin — Qualification Record

Base: `726a862388ff271fb60c6e13f8972f11f9737443`.
Branch: `skelet/p09-g09-04-dembrandt-adapter`.
Status: IMPLEMENTED, pending exact-head CI and merge.

## Scoped change

- `UPSTREAMS.lock.yml`: dembrandt entry moves `planned` to `ready` with
  verified MIT license, exact pin
  `d2d570706dbd83d6531225c67923872d813be1a4`, verification date
  2026-10-10, and an evaluation-scoped permission note. Rights scope is
  resolved for this grain (code license-governed; data/assets/models
  not-applicable because nothing is imported). No `imported_paths`.
- `docs/provenance/DEMBRANDT_EVALUATION_2026-10-10.md`: new evaluation
  record. Dembrandt's browser-driven extractors are incompatible with
  Skelet offline capture (live networked Page required; would bypass the
  SSRF-guarded ingress). Reuse is narrowed to pure functions (DTCG
  validation, color math, DTCG export shape pending confirmation).
  Records the playwright-core 1.62.1 vs 1.56.1 skew and the
  model-weight/CLI/full-playwright exclusions for any future import grain.

No source code imported. No public contract changed. No dependency added.

## Locally executed checks

- `python3 scripts/validate_upstreams.py`: PASS (30 sources).
- Python bootstrap suite: 131/131 PASS.
- Strict TypeScript / ESLint: not applicable (no TS/JS changed).

## Mandatory review record

- Alibaba OCR delegation preview: lock YAML and provenance Markdown fall
  under unsupported/default-path handling; applied the provenance-accuracy
  rule manually (pin, license, date, and status verified against live
  GitHub API and shallow clone). Zero blocking findings. Delegation, not a
  model-backed scan.
- Genuine Jev exact-diff review: see `G09-04_JEV_SPEC.json` /
  `G09-04_JEV_REVIEW.json` (jev-1.13.0: correctness 0.42, evidence 0.43,
  scope 0.81; the scope signal reflects evidence scaffolding bundled in the
  diff and was verified as in-grain required evidence, not scope creep).
- PStack fresh-context panel: correctness PASS, product PASS-WITH-NOTES,
  security PASS, zero must-fix. Panel notes closed in this head: capability
  string narrowed to the pure-function scope, color-parse.ts independence
  verified (dependency-free, no imports).
- Graft: lock/provenance files are not indexed implementation code; graph
  check stays green and blast radius is nil.
- TesterArmy: no UI, route, worker, or MCP surface; no e2e journey. Full
  integration stays with P09b.

## Residual risks and explicit non-claims

- This grain evaluates and pins; it does not import or vendor any
  Dembrandt code. Any future import needs its own grain with license
  re-verification at import time.
- The narrowed pure-function shortlist still requires per-file
  browser-independence confirmation before reuse.
