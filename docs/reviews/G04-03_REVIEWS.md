# G04-03 Review Records (OCR delegation + Pstack panel + Jev)

Base: `dba56f4bb0a94d1d2ff5eeb8f3b7eaaf06eb6b8a` (canonical main).
Branch: `skelet/p04-g04-03-collections`.
Code HEAD reviewed: `092ec69120f2b129a3e0d729829abaf6f0b7fd36`
(two commits: `a1848c7` baseline, `092ec69` review fixes).

## Alibaba OCR delegation (not an LLM-backed scan)

- OCR `open-code-review v1.12.13`; no provider credential, so the official
  `ocr delegate` workflow per `GOVERNANCE.md` was used on the exact range.
- Preview: 13 reviewable / 13 total (no unsupported or excluded files).
- Rules executed: TS/JS quality on `collections.ts`; default-group
  correctness/security/performance/maintainability/coverage on both
  migration files; workflow security on `ci.yml` (one added test path).
- Delegated findings: zero blocking.

## Pstack panel (skills loaded; panel via fresh-context subagents)

- Light combined judge (correctness/parsimony/product) + dedicated security
  judge (workspace-authorization trigger), both in fresh context.
- Combined verdict: 0 must-fix, 3 worth-considering. Fixed in `092ec69`:
  oracle/migration header comments reworded; raw storage primitives
  recorded as fixture/migration-layer (product paths use the authorized
  service). Accepted: per-module helper duplication (repo style).
- Security verdict: 0 must-fix, 3 worth-considering. Fixed: admin
  visibility-flip restricted to owner_subject (admins keep rename/delete),
  with a dedicated denial test. Accepted with rationale: not-found vs
  forbidden split (unguessable UUIDs; tests pin it; both fail closed),
  global-canonical artifact probing (artifacts are source-bound corpus,
  not workspace-scoped, by canonical model).
- Panel re-verification after fixes: db lint clean, tsc strict clean,
  collections 6/6, db suites sequential 56/56.
- Manifest: `panel: light ✓ combined (task model) · correctness pass ·
  parsimony pass · product G04-03 met` +
  `panel: security ✓ (task model) · 0 must-fix`.

## TypeSafe Jev (genuine runs, `jev-1.13.0`)

- Pre-fix broad: correctness 0.16, security 0.23, scope 0.23,
  reliability 0.47, compatibility 0.12, evidence 0.63.
- Targeted probes after fixes: evidence gap 0.14, corruption 0.26 —
  every behavior mapped to its passing test and mechanism.
- Full machine-readable record: `G04-03_JEV_SPEC.json`,
  `G04-03_JEV_REVIEW.json` in this directory.
- Outcome: zero unresolved blocking findings.

## Execution notes (durable)

- The 6-file parallel PGlite run exceeds this box's free RAM (~2.3 GB
  free of 16 GB); suites were proven sequentially file-by-file (56/56)
  plus pairwise. GitHub CI runners carry headroom for the parallel
  command; exact-head CI on the PR is the binding parallel proof.
- A mid-grain `ON CONFLICT DO NOTHING` repair replaced a
  catch-unique-then-select fallback that PostgreSQL/PGlite aborts
  (25P02); the idempotent save path now keeps the transaction healthy.
- A mid-grain line-ending repair reverted CRLF churn in two test files
  before commit; the staged diff holds only intended lines.
