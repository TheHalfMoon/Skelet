# G05-02 Review Records (OCR delegation + Pstack panel + Jev)

Base: `29c3cfa88a3cd33a3a17a379ed2765d290b75b5c` (canonical main).
Branch: `skelet/p05-g05-02-provider-contract`.
Code HEAD reviewed: `17cf5c55755231052eaf9970e7b605c5913b8fc9`
(two commits: `235c320` baseline, `17cf5c5` review fixes).

## Alibaba OCR delegation (not an LLM-backed scan)

- OCR `open-code-review v1.12.13`; no provider credential, so the official
  `ocr delegate` workflow per `GOVERNANCE.md` was used on the exact range.
- Preview: 6 reviewable / 7 total (`pnpm-lock.yaml` default_path-excluded;
  covered by frozen install + hygiene per precedent).
- Rules executed: TS/JS quality on `provider.ts` (no typos/dead code/`var`/
  `==`/`any`/nested ternaries; async/await; no eval/innerHTML/secrets);
  JSON/YAML key rules on `package.json`/`tsconfig.json`; workflow security
  on `ci.yml` (new job mirrors established pattern: pinned actions,
  exact-HEAD verify, no secrets, least privilege).
- Delegated findings: zero blocking.

## Pstack panel (skills loaded; panel via fresh-context subagents)

- Light combined judge (correctness/parsimony/product) + dedicated security
  judge, both in fresh context.
- Combined verdict: 0 must-fix, 5 worth-considering. Adopted in `17cf5c5`:
  optional `checkInput` guard (closes the plan input-schema gap),
  failure-provenance deferral recorded for G05-03, redaction-boundary note
  in module doc. Accepted: first-aborter race priority (restructure makes
  first-settler win explicitly), typed-error passthrough priority
  (spec-matched), tsconfig monet-exclude rationale (recorded below).
- Security verdict: BLOCKING-to-fixed — advisory-only timeout/cancel
  restructured into a settling race; proven by a signal-ignoring fixture
  settling in ~61ms instead of 5000ms. Also fixed: message truncation,
  registry freeze + capability validation. Accepted: worker-ID auth
  deferred to web grain (no trigger at this layer), boundary
  redact/encode duty documented.
- Panel re-verification after fixes: providers lint clean, tsc strict
  clean, 8/8 tests pass.
- Manifest: `panel: light ✓ combined (task model) · 0 must-fix` +
  `panel: security ✓ (task model) · must-fix closed`.
- Rationale records: `tsconfig.json` excludes `monet/` because that donor
  file keeps its own isolated CI typecheck with different module
  settings; failure-provenance envelopes defer to G05-03 audit needs;
  the hand-rolled HMAC-free contract stays dependency-free by cost rule.

## TypeSafe Jev (genuine runs, `jev-1.13.0`)

- Broad: correctness 0.15, security 0.24, scope 0.29, reliability 0.51,
  compatibility 0.09, evidence 0.58.
- Targeted reliability probe after the enforcement fix: 0.30 with the
  defect closed and proven. Measured meter insensitivity per the G02-02
  precedent; the panel verdict plus the mapping carries the gate.
- Full machine-readable record: `G05-02_JEV_SPEC.json`,
  `G05-02_JEV_REVIEW.json` in this directory.
- Outcome: zero unresolved blocking findings.
