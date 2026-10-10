# G09b-01 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context read-only sessions over the schema, the
validator, the fixture, and the 4-test suite. Specialized agent providers
unavailable: the judges used inline bars, not four independent provider
models. This record MUST NOT be described as four independent provider
models.

## Initial fresh-context panel

Review basis: base `8dc852b…` through the working tree. Targeted runs:
bootstrap suite 135/135 (131 prior + 4 new), validator PASS on the valid
fixture, compileall clean.

## Must-fix

- **None.**

## Worth considering (one accepted)

- **A1 — `kit_id` opacity is unverified.**
  The validator checks `kit_id` shape (64 hex) but cannot verify it binds
  the kit bytes without a canonical serialization rule. ACCEPTED as
  documented v1 scope: `kit_id` is an opaque identity until the job
  lifecycle grain defines canonical kit hashing; the `lens_report`
  binding (analysis_id equality plus report sha256) already ties every
  kit to its qualified Lens report.

## Four-bar verdicts

- **Correctness: PASS** — schema and validator agree field-for-field;
  16 adversarial negatives (version, status, report mismatch, scope
  overflow, empty pages, http URL, missing export, traversal, absolute
  path, kind swap, redistributable unknown/restricted, heuristic content,
  label forgery, policy downgrade, starter escape) all fail; the valid
  fixture passes both gates.
- **Parsimony: PASS** — one schema, one stdlib script, one fixture, one
  test file, one 3-line CI step; no implementation, no dependencies.
- **Product: PASS** — P09b layout frozen before job logic per the plan;
  fixed 7-file export set plus starter/screenshots trees; synthesis label
  forbids original-source confusion; rights firewall keeps unknown bytes
  out of redistributable artifacts.
- **Security: PASS** — traversal, absolute-path, backslash, and dot
  segments rejected; redistributable-permitted firewall enforced for all
  four classifications; report binding equality enforced.

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.
