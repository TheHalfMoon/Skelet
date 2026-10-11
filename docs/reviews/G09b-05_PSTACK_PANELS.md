# G09b-05 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context read-only sessions over the kit manifest
assembler, its 14-test suite, and the one-line CI addition.
Specialized agent providers unavailable: the judges used inline bars,
not four independent provider models. This record MUST NOT be
described as four independent provider models.

Review basis: base `f2c4cb5…` through the working tree. Targeted runs:
lens kit-manifest 14/14, full lens 151/151, lens typecheck + ESLint
clean, canonical `scripts/validate_build_kit.py` parity PASS on a
TS-assembled manifest (zero errors) plus tamper check (validator
flags a redistributable-marked unknown artifact).

## Must-fix (none; evidence-signal triage closed pre-commit)

- First Jev pass reported evidence 0.71 with no demonstrated defect.
  Triage added four committed boundary tests (all nine statuses,
  integer edges, length/count edges, all-permitted partition); second
  pass evidence 0.47. A committed cross-runtime parity test does not
  fit the CI topology (bootstrap job has no Node.js; lens job has no
  Python), so parity is established by the manual validator run above
  instead of a fabricated in-suite check.

## Worth considering (two accepted advisories)

- **A1 — `asset-inventory` kind has no legal kit path.**
  The v1 enum names the kind but the fixed layout plus the `starter/`
  and `screenshots/` prefixes pin every legal path to another kind,
  so the assembler fails closed on it. ACCEPTED as the safe reading;
  placement belongs to a versioned contract amendment, not to
  guesswork here.
- **A2 — Jev scores are probabilistic, not verdicts.**
  Post-repair band (correctness ~0.13, security ~0.07, evidence
  ~0.47) sits at or below previously merged grains; branch-by-branch
  review shows no open defect and every branch is covered by a
  committed test. ACCEPTED with the triage recorded here.

## Four-bar verdicts

- **Correctness: PASS** — schema_version, report binding equality,
  snake_case scope mapping, 1..25 pages, 1..500 artifacts, all seven
  required exports enforced, path/kind pairing exact, byte ranges
  exact, rights derived (never trusted), partition order-preserving.
- **Parsimony: PASS** — one pure module mirroring the frozen schema
  and validator, one test file, one CI line; no ZIP, starter,
  storage, network, or public API.
- **Product: PASS** — deterministic manifest assembly plus the
  shippable/withheld split that keeps restricted bytes out of
  downloads, exactly the G09b-05 assembly slice; ZIP packaging stays
  in its own grain.
- **Security: PASS** — traversal/absolute/over-long paths rejected,
  duplicates rejected, unknown fields rejected, non-permitted bytes
  never redistributable, bounded 80-char provenance items, no secret
  material.

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.
