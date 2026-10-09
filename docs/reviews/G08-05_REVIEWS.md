# G08-05 Review Records (OCR delegation + Pstack panel + Jev)

Base: `6854eb363c20ba4226dcec43d911b242b7ced98a` (canonical main).
Branch: `skelet/p08-g08-05-ts-sdk`.
Code HEAD reviewed: `3677cff0c7bd9f82eeb56aed0dff04c959e949c1`
(two commits: `e76be6e` baseline, `3677cff` review fixes).

## Alibaba OCR delegation (not an LLM-backed scan)

- OCR `open-code-review v1.12.13`; no provider credential, so the official
  `ocr delegate` workflow per `GOVERNANCE.md` was used on the exact range.
- Preview: 6 reviewable / 7 total (`pnpm-lock.yaml` default_path-excluded;
  covered by frozen install + hygiene per precedent).
- Rules executed: TS/JS quality on `client.ts`; JSON key rules on
  `package.json`; workflow security on `ci.yml` (new job mirrors the
  package pattern).
- Delegated findings: zero blocking.

## Pstack panel (skills loaded; panel via fresh-context subagents)

- Light combined judge (correctness/parsimony/product) + dedicated security
  judge (credential-handling trigger), both in fresh context.
- Combined verdict: 0 must-fix, 6 worth-considering. Adopted all six in
  `3677cff` except the documented ones: redirect policy, shape guards,
  ambiguity rejection, URL validation, seam documentation, contract
  version export with test.
- Security verdict: 1 must-fix (redirect Bearer leak) + 2
  worth-considering, all fixed: `redirect: "error"` with a redirect test,
  HTTPS-only base URLs with localhost opt-in, documented fetch seam.
- Panel re-verification after fixes: sdk lint/tsc clean, 6/6 tests pass.
- Manifest: `panel: light ✓ combined (task model) · 0 must-fix` +
  `panel: security ✓ (task model) · must-fix closed`.
- Thin read slice (3 methods) is the recorded grain boundary; writes,
  Python SDK, and CLI are named follow-ups, not gaps of this grain.

## TypeSafe Jev (genuine runs, `jev-1.13.0`)

- Broad: correctness 0.14, security 0.26, scope 0.41, reliability 0.33,
  compatibility 0.10, evidence 0.78.
- Targeted probes: correctness-no-defect 0.15 with every panel finding
  closed and tested. Earlier elevated readings traced to scope thinness
  via a cleanly-worded probe, then to the meter floor.
- Full machine-readable record: `G08-05_JEV_SPEC.json`,
  `G08-05_JEV_REVIEW.json` in this directory.
- Outcome: zero unresolved blocking findings.
