# G09-05 OpenBrand Evaluation and Verified Pin — Qualification Record

Base: `0df34e18445685de5b4d7f08ab42ae564ee702f8`.
Branch: `skelet/p09-g09-05-openbrand-eval`.
Status: IMPLEMENTED, pending exact-head CI and merge.

## Scoped change

- `UPSTREAMS.lock.yml`: openbrand entry moves `planned` to `ready` with
  verified MIT license, exact pin
  `a21d34fadc3dcf15271d71fdb3f7d95baf7578d8`, verification date
  2026-10-10, and an evaluation-scoped permission note. Rights scope is
  resolved for this grain (code license-governed; data/assets/models/
  services not-applicable because nothing is imported; trademarks
  restricted). No `imported_paths`.
- `docs/provenance/OPENBRAND_EVALUATION_2026-10-10.md`: new evaluation
  record. OpenBrand's live fetch path (global fetch plus third-party reader
  fallback) is rejected for SSRF posture and external-egress reasons; reuse
  is narrowed to output-shape and heuristic reference. Extracted brand bytes
  stay trademark-restricted and out of downloadable artifacts.

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
- Genuine Jev exact-diff review: see `G09-05_JEV_SPEC.json` /
  `G09-05_JEV_REVIEW.json` (jev-1.13.0: correctness 0.40, evidence 0.67,
  scope 0.88). Load-bearing claims were directly re-verified: scraper.ts
  carries exactly 3 exports (parseHtml/fetch path private), lib/url.ts is a
  7-line normalizer with no guard. The elevated signals reflect judge
  uncertainty over evaluation-style grains, not a defect; PStack reproduced
  every material claim.
- PStack fresh-context panel: correctness PASS, product PASS, security PASS,
  zero must-fix. The graft `.ignore` re-admit file stays untracked and out
  of the merge; the merged set is lock plus docs only.
- Graft: lock/provenance files are not indexed implementation code; graph
  check stays green and blast radius is nil.
- TesterArmy: no UI, route, worker, or MCP surface; no e2e journey. Full
  integration stays with P09b.

## Residual risks and explicit non-claims

- This grain evaluates and pins; it does not import or vendor any OpenBrand
  code. Any future brand-clue parser grain must be clean-room Skelet-owned
  code behind the G05-02 provider contract, with license re-verification at
  that time.
- `parseHtml` heuristics are referenced as design input, not as imported
  behavior; fidelity of any future port must be proven by Skelet's own
  fixture tests.
