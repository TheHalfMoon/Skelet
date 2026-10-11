# AF-03a PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context read-only sessions over the agent-contract
schema, the validator, the 4 fixtures, the 8-test suite, and the 1-line
CI wiring. Specialized agent providers unavailable: the judges used
inline bars, not independent provider models. This record MUST NOT be
described as independent provider models. PStack binary functionality is
unavailable in this environment; this panel is the manual fresh-context
PStack equivalent required by governance, with unavailable functionality
reported here accurately.

Review basis: base `97ac8196749edbff6261c01eaa62be80e64f7b40` through
candidate head `b4dfaf3458d3698520af8c8e97690c0c6a771730`.
Targeted runs: `test_validate_agent_contract` 8/8, full Python suite
164/164, `validate_agent_contract` gate PASSED, `ci_hygiene` passed,
`git diff --check` clean, Graft build and check OK with blast showing
1 changed area and no indexed dependents.

## Must-fix (two defects found and closed pre-evidence-commit)

- **M1 — envelope fixture carried a non-contract top-level field.**
  The first draft of `valid-envelope.json` included a top-level `uri`
  that the envelope contract does not allow. The gate correctly failed
  closed. Fixed by moving URI coverage into `result` and
  `provenance.source_uri`. Proved by gate PASSED plus 8/8 green.
- **M2 — unused tool-name constant in the validator.**
  `TOOL_NAMES` was declared but never read by validation logic. Removed
  structurally; the implemented tool surface is asserted in the test
  from a local literal instead. Proved by 8/8 green with no import.

## Evidence-signal triage (closed pre-evidence-commit)

- Three consecutive genuine Jev passes (`jev-1.13.0`, `ok: true`):
  0.11/0.15/0.53/0.19/0.07/0.07, then 0.11/0.16/0.53/0.19/0.07/0.07,
  then 0.12/0.15/0.53/0.18/0.07/0.08. Zero blocking findings every run.
  The evidence signal 0.53 sits marginally above the 0.5 threshold with
  no demonstrated defect. Triage re-ran every gate locally and reviewed
  every changed path: the schema file is covered by the JSON rule plus a
  committed self-check test asserting the 13-code enum, envelope keys,
  and URI pattern behavior; the validator is covered by 8 tests plus the
  Python rule; the CI line is covered by the workflow rule plus
  bootstrap CI; fixtures are covered by the gate plus the suite. M1 and
  M2 above were the only real defects and both are closed structurally.
  No open defect.

## Worth considering (one accepted advisory)

- **A1 — Jev scores are probabilistic, not verdicts.**
  Band 0.07 to 0.53 with `ok: true` and zero blocking findings; every
  changed path is covered by a committed test, gate proof, or validator.
  ACCEPTED with the triage recorded here.

## Four-bar verdicts

- **Correctness: PASS** — `skelet.agent.v1` envelope with complete and
  partial states, 13 typed error codes, stable URI patterns rejecting
  traversal and unknown kinds, 5 evidence modes, cursor and warnings
  budgets, valid fixtures pass and invalid fixtures fail.
- **Parsimony: PASS** — one schema, one validator, 4 fixtures, one test
  file, one CI line. No MCP, REST, Lens, search, or DB behavior change.
  No migration, no UI, no billing, no donor import.
- **Product: PASS** — exactly the AF-03a slice: additive contract freeze
  before parity behavior. AF-03b (envelope and error parity) and AF-03c
  (three independent clients) build on this frozen contract.
- **Security: PASS** — traversal URIs rejected, invented error codes
  rejected, no secret values in fixtures or messages, no new network
  authority.

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.
