# G09-07 Squirrelscan Evaluation and Verified Pin — Qualification Record

Base: `ec001deba4f7fb788f881bd84eec6723b985c869`.
Branch: `skelet/p09-g09-07-squirrelscan-eval`.
Status: IMPLEMENTED, pending exact-head CI and merge.

## Scoped change

- `UPSTREAMS.lock.yml`: squirrelscan entry moves `planned` to `ready` with
  verified MIT license, exact pin
  `b0e209c44c14ef5340de030c36b3b075fa49a6ff`, verification date
  2026-10-10, and an evaluation-scoped permission note. Rights scope is
  resolved for this grain (code license-governed; data/assets/models/
  services not-applicable because nothing is imported; trademarks
  restricted). No `imported_paths`.
- `docs/provenance/SQUIRRELSCAN_EVALUATION_2026-10-10.md`: new evaluation
  record. The deterministic rule shape (HTML in, graded checks out) is
  reference-compatible; the bun/Effect engine, crawler, live fetchers, and
  cloud services are rejected. Lens required path stays local with this
  provider disabled.

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
- Genuine Jev exact-diff review: see `G09-07_JEV_SPEC.json` /
  `G09-07_JEV_REVIEW.json` (jev-1.13.0: correctness 0.41, evidence 0.68,
  scope 0.88; evaluation-grain uncertainty pattern, PStack reproduced every
  material claim).
- PStack fresh-context panel: correctness PASS, product PASS, security PASS,
  zero must-fix. Panel note closed in this head: the rule-count figure is
  now attributed (upstream-described 301+, 145 test files observed in the
  pinned clone).
- Graft: lock/provenance files are not indexed implementation code; graph
  check stays green and blast radius is nil.
- TesterArmy: no UI, route, worker, or MCP surface; no e2e journey. Full
  integration stays with P09b.

## Residual risks and explicit non-claims

- This grain evaluates and pins; it does not import or vendor any
  Squirrelscan code. Any future QA layer must be clean-room Skelet-owned
  code behind the G05-02 provider contract, with license and third-party
  notices re-verified at that time.
- The four Lens provider evaluations (G09-04 through G09-07) are complete;
  provider *implementation* grains remain future work under P09.
