# G09-06 OpenTechAlyzer Evaluation and Verified Pin — Qualification Record

Base: `3389fbcc6c85d83fd3048961a1e89b9528f8b89d`.
Branch: `skelet/p09-g09-06-opentechalyzer-eval`.
Status: IMPLEMENTED, pending exact-head CI and merge.

## Scoped change

- `UPSTREAMS.lock.yml`: opentechalyzer entry moves `planned` to `ready`
  with verified MIT license, exact pin
  `a3d30e479c91c06732ef88867d69b7feef8f3f35`, verification date
  2026-10-10, and an evaluation-scoped permission note. Rights scope is
  resolved for this grain (code license-governed; data/assets/models/
  services not-applicable because nothing is imported; trademarks
  restricted). No `imported_paths`.
- `docs/provenance/OPENTECHALYZER_EVALUATION_2026-10-10.md`: new evaluation
  record. Live collectors and external enrichment are rejected for
  offline-capture posture and no-external-service rule; reuse is narrowed to
  fingerprint-database and evidence-graded engine reference for a future
  Skelet-owned bounded tech-clue matcher over guarded capture evidence.

No source code imported. No public contract changed. No dependency added.

## Locally executed checks

- `python3 scripts/validate_upstreams.py`: PASS (30 sources).
- Python bootstrap suite: 131/131 PASS.
- Strict TypeScript / ESLint: not applicable (no TS/JS changed).

## Mandatory review record

- Alibaba OCR delegation preview: lock YAML reviewable; provenance and
  reviews Markdown excluded by the unsupported-ext rule. Provenance-accuracy
  rules applied manually (pin, license, date verified against live GitHub
  API and shallow clone). Zero blocking findings. Delegation, not a
  model-backed scan.
- Genuine Jev exact-diff review: see `G09-06_JEV_SPEC.json` /
  `G09-06_JEV_REVIEW.json` (jev-1.13.0: correctness 0.42, evidence 0.61,
  scope 0.88; evaluation-grain uncertainty pattern as in G09-04/G09-05,
  PStack reproduced every material claim).
- PStack fresh-context panel: correctness PASS, product PASS, security PASS,
  zero must-fix. Panel note closed in this head: the runtime community
  dataset is named as GPL-3.0 (`enthec/webappanalyzer`, verified in
  `external.ts`), which independently confirms the merge-disabled rationale
  on license-incompatibility grounds.
- Graft: lock/provenance files are not indexed implementation code; graph
  check stays green and blast radius is nil.
- TesterArmy: no UI, route, worker, or MCP surface; no e2e journey. Full
  integration stays with P09b.

## Residual risks and explicit non-claims

- This grain evaluates and pins; it does not import or vendor any
  OpenTechAlyzer code. Any future tech-clue matcher must be Skelet-owned
  code behind the G05-02 provider contract, with license re-verification at
  that time, unpinned community data disabled, and clues explicitly
  low-confidence with evidence links.
