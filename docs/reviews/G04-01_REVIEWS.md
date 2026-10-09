# G04-01 Review Records (OCR delegation + Pstack panel + Jev)

Base: `752688db7423b4d2b99f0b05a0e3b24db3c37a4f` (canonical main).
Branch: `skelet/p04-g04-01-auth-baseline`.
Code HEAD reviewed: `cd968045292ce81759dbbbe3762999ade7a88f45`
(two commits: `2b79980` baseline, `cd96804` review fixes).

## Alibaba OCR delegation (not an LLM-backed scan)

- OCR `open-code-review v1.12.13`; no provider credential, so the official
  `ocr delegate` workflow per `GOVERNANCE.md` was used on the exact range.
- Preview: 11 reviewable / 11 total (no unsupported or excluded files).
- Rules executed: TS/JS quality on `auth.ts` (no typos/dead code/`var`/
  `==`/`any`/nested ternaries; async error handling; no eval/innerHTML;
  no secrets); default-group correctness/security/performance/
  maintainability/coverage on both migration files (parameterized SQL only,
  locked trigger search_path, cascade discipline, reversible down
  migration); workflow security on `ci.yml` (one added test path; no
  permission/secret/pin/script-injection change).
- Delegated findings: zero blocking. One non-blocking observation recorded:
  sign-in CPU-DoS hardening (async scrypt, rate limits) belongs to the
  networked P04 grain, not this offline service module.

## Pstack panel (skills loaded; panel via fresh-context subagents)

- Light combined judge (correctness/parsimony/product) + dedicated security
  judge (auth trigger surface), both in fresh context on the exact diff.
- Combined verdict: pass. 5 worth-considering findings, all addressed in
  `cd96804`: FK/malformed-identifier AuthError mapping, aliased join
  columns with Date-aware expiry parse, server-clock contract note,
  max-TTL/default-lifetime/stored-email test assertions. Accepted
  residuals with rationale: pinned scrypt params asserted literally
  (deliberate; cost bumps must update tests explicitly), `tx` handle naming
  (safety documented as index-backed, not handle-backed), now-injection
  shape (harmless at this size).
- Security verdict: pass, 0 must-fix. Fail-closed posture holds; no
  plaintext storage; enumeration-safe sign-in; parameterized SQL only.
  Deferredandre corded: sign-up enumeration rate limits, async scrypt +
  rate limits, pepper/HMAC defense-in-depth, NFKC email folding — all
  require a network surface that this grain does not add.
- Panel re-verification after fixes: db lint clean, tsc strict clean,
  db suite 43/43 (10 auth), python 107 OK, hygiene passed.
- Manifest: `panel: light ✓ combined (task model) · correctness pass ·
  parsimony pass · product complete, no creep` +
  `panel: security ✓ (task model) · 0 must-fix`.

## TypeSafe Jev (genuine runs, `jev-1.13.0`)

- Pre-fix broad: correctness 0.16, security 0.14, scope 0.13,
  reliability 0.27, compatibility 0.09, evidence 0.63.
- Post-fix broad: correctness 0.13, security 0.18, scope 0.30,
  reliability 0.32, compatibility 0.09, evidence 0.60.
- Targeted evidence-gap probe (every acceptance behavior mapped to its
  passing test): 0.13, disproving the broad evidence signal per the
  established G02-02 diagnosis pattern.
- Full machine-readable record: `G04-01_JEV_SPEC.json`,
  `G04-01_JEV_REVIEW.json` in this directory.
- Outcome: zero unresolved blocking findings.
