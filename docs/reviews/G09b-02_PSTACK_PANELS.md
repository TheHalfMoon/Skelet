# G09b-02 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context read-only sessions over the 009 migration,
the build-kit service, both test suites, the ledger-list updates, and
the CI test-list additions. Specialized agent providers unavailable:
the judges used inline bars, not four independent provider models.
This record MUST NOT be described as four independent provider models.

Review basis: base `d5bae3d…` through the working tree. Targeted runs:
db PGlite 94/94 (72 prior + 22 new), real-PostgreSQL kit suite 5/5,
other real-PG suites 2/2 + 2/2 + 5/5 in CI order, python 135/135,
strict typecheck + ESLint clean, upstreams 30, skills 4, kit validator
PASS, hygiene PASS.

## Must-fix (one found and closed)

- **M1 — unknown request fields silently ignored.**
  `normalizeRequest` accepted arbitrary extra top-level fields, so a
  misspelled budget (e.g. `maxpages`) would parse fail-open with the
  default scope instead of rejecting. Fixed structurally: an explicit
  known-field set rejects unknown fields with
  `buildkit/invalid-request`; a negative test (`tenant: "intruder"`)
  pins the behavior.

## Worth considering (two accepted advisories)

- **A1 — subscription status is not gated.**
  Quota caps resolve from the subscription plan key (or free by
  default) without checking `active` versus `past_due`/`canceled`.
  ACCEPTED as documented G09b-02 scope: billing-status enforcement
  belongs to P15 commercial gating; the lifecycle records the plan
  key it enforced against and never invents entitlements.
- **A2 — worker advance is server-trusted.**
  `advanceKitRun` scopes by workspace plus opaque kit identity plus
  lease ownership but does not check user membership; the HTTP/API
  wiring grain MUST resolve the workspace server-side and never accept
  a client workspace claim. ACCEPTED with the layering documented in
  the module header (same pattern as the existing DB-only mutations).

## Four-bar verdicts

- **Correctness: PASS** — nine-state matrix matches the frozen
  contract field-for-field; trigger and service matrix agree;
  completed requires artifacts plus validation evidence, failed
  requires classification, partial requires gaps, terminal rows never
  resurrect (proven by direct-SQL negatives); retry budget, history
  preservation, checkpoint validation, and expiry purge all hold.
- **Parsimony: PASS** — one migration, one service module, two test
  files, ledger-list updates, two CI lines; reuses workspace
  membership, plan capabilities, and transactional discipline; no new
  queue, database, or billing service.
- **Product: PASS** — durable AnalysisRun lifecycle with idempotent
  submission, poll/cancel/retry/resume/expiry, tenant isolation, and
  quota accounting, exactly the G09b-02 slice; no capture traversal,
  generation, synthesis, network, or public API; frozen G09b-01
  schema untouched.
- **Security: PASS** — cross-tenant reads fail closed as not-found,
  membership denials stay generic, identities are opaque
  tenant-scoped hashes, idempotency keys cannot collide across
  tenants, quota ledger cannot go negative (CHECK constraints),
  leases fence workers, and no secrets enter logs or errors.

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.
