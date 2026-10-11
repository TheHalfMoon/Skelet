# G09b-06 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context read-only sessions over the kit ZIP
packager, its 15-test suite, and the one-line CI addition.
Specialized agent providers unavailable: the judges used inline bars,
not four independent provider models. This record MUST NOT be
described as four independent provider models.

Review basis: base `d4f4a1c…` through the working tree. Targeted runs:
lens kit-package 15/15, full lens 166/166, lens typecheck + ESLint
clean, independent python-zipfile validation (sorted entries,
ALL_CRC_OK) of a packaged kit.

## Must-fix (one design defect found and closed pre-commit)

- **M1 — manifest self-hash fixed point does not exist.**
  The first draft tried to converge the `manifest.json` record onto
  the hash of its own document; that is a preimage puzzle, not a
  fixed point, and the suite proved it (no convergence in 4 rounds).
  Replaced structurally with the self-digest rule: the record carries
  the SHA-256 of the manifest minus the self entry (stable by
  construction) plus the exact document length, and packaging
  re-derives both. Documented in the module header, covered by a
  dedicated tamper test.

## Evidence/security-signal triage (closed pre-commit)

- First Jev pass: evidence 0.71, security 0.17. Triage added the
  deflate-method rejection test, the traversal-path rejection test
  (plus a path-safety gate in `parseKitPackage`: absolute paths,
  backslashes, empty/dot/dotdot segments rejected), and the
  central-authoritative-names test. Second pass: evidence 0.52,
  security 0.11. Zip-bomb amplification is impossible by
  construction (stored method only, scope byte cap, 500-entry cap).

## Worth considering (one accepted advisory)

- **A1 — Jev scores are probabilistic, not verdicts.**
  Post-repair band sits at previously merged levels; branch-by-branch
  review shows no open defect and every branch is covered by a
  committed test. ACCEPTED with the triage recorded here.

## Four-bar verdicts

- **Correctness: PASS** — stored ZIP with valid signatures, offsets,
  and CRC32 (externally validated); byte-identical rebuilds; sorted
  entries; fixed timestamps; withheld exclusion with
  withheld-supplied failure; document/record equality; self-digest
  rule; scope byte cap; corruption and truncation rejected.
- **Parsimony: PASS** — one dependency-free module (node:crypto only),
  one test file reusing the G09b-05 assembler for genuine fixtures,
  one CI line; no compression, encryption, network, storage, or
  public API.
- **Product: PASS** — deterministic packaging plus a parse verifier
  for the validating-status grain, exactly the G09b-06 slice; starter
  content generation stays in its own grain.
- **Security: PASS** — traversal/absolute paths rejected on parse,
  non-stored methods rejected, withheld bytes fail instead of leak,
  CRC mismatches reported as corruption, no secret material.

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.
