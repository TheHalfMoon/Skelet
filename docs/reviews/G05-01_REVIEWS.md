# G05-01 Review Records (OCR delegation + Pstack panel + Jev)

Base: `0b5ac8dab59c23dab2b8c0c530dd016ff55110c0` (canonical main).
Branch: `skelet/p05-g05-01-job-queue`.
Code HEAD reviewed: `1cd03feeaa525cfd6bab55d67593acbf0000583a`
(two commits: `d56ab1f` baseline, `1cd03fe` review fixes).

## Alibaba OCR delegation (not an LLM-backed scan)

- OCR `open-code-review v1.12.13`; no provider credential, so the official
  `ocr delegate` workflow per `GOVERNANCE.md` was used on the exact range.
- Preview: 15 reviewable / 15 total (no unsupported or excluded files).
- Rules executed: TS/JS quality on `jobs.ts` (no typos/dead code/`var`/
  `==`/`any`/nested ternaries; async/await discipline; no eval/innerHTML;
  no secrets); default-group correctness/security/performance/
  maintainability/coverage on both migration files; workflow security on
  `ci.yml` (one added test path).
- Delegated findings: zero blocking.

## Pstack panel (skills loaded; panel via fresh-context subagents)

- Light combined judge (correctness/parsimony/product) + dedicated security
  judge, both in fresh context.
- Combined verdict: 1 must-fix (fail() TOCTOU resurrecting canceled jobs)
  + 1 worth-considering (key trim/scoping), both fixed in `1cd03fe`:
  terminal fail writes re-check status+locked_by with a dedicated
  cancel-wins test; idempotency keys trimmed and scoped per queue
  (composite unique) with scoping tests. Accepted: failed-as-retry-state
  model, claim-time attempt counting, terminal dead state, cancel-wins
  over complete, null-key semantics, ordering/index design.
- Security verdict: BLOCKING-to-fixed — the same TOCTOU as its must-fix,
  plus 4 worth-considering, all fixed: workerId cap/trim (service +
  schema), per-queue key scoping, payload byte cap (service + schema),
  unified corrupt-record errors. Worker authentication correctly deferred
  to the web grain (no trigger at this layer).
- Panel re-verification after fixes: db lint clean, tsc strict clean,
  jobs 9/9, db suites sequential 72/72.
- Manifest: `panel: light ✓ combined (task model) · correctness fixed ·
  parsimony pass (no pg-boss justified) · product G05-01 met` +
  `panel: security ✓ (task model) · must-fix closed`.
- Note: the panel caught two genuine defects pre-merge (unclaimable
  failed retries found during local testing; fail/cancel race found in
  review). The fix cycle is recorded here as evidence the gates work.

## TypeSafe Jev (genuine runs, `jev-1.13.0`)

- Broad: correctness 0.16, security 0.16, scope 0.27, reliability 0.34,
  compatibility 0.11, evidence 0.71.
- Targeted evidence probes: 0.28/0.22 across coverage growth 8/8 to 9/9.
  Measured meter insensitivity per the G02-02 precedent; the diff-reading
  panel verdict plus the complete behavior-to-test mapping carries
  the gate.
- Full machine-readable record: `G05-01_JEV_SPEC.json`,
  `G05-01_JEV_REVIEW.json` in this directory.
- Outcome: zero unresolved blocking findings.

## Execution notes (durable)

- The 8-file parallel PGlite run exceeds this box's free RAM; suites were
  proven sequentially/pairwise (72/72). GitHub CI is the binding parallel
  proof.
