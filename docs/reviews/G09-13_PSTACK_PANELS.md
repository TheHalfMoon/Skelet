# G09-13 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context read-only sessions over the orchestration
module and its 4-test suite. Specialized agent providers unavailable: the
judges used inline bars, not four independent provider models. This
record MUST NOT be described as four independent provider models.

## Initial fresh-context panel

Review basis: base `864b8cb…` through the working tree. Targeted runs:
analyze-url 4/4, full lens 117/117, typecheck clean, lint clean, Python
bootstrap 131/131.

## Must-fix

- **None.**

## Worth considering (one accepted)

- **A1 — Default capture stage has no live-URL test.**
  The happy-path test stubs the network edge with genuine Chromium
  evidence and runs real assembly plus real export; the real
  `capturePublicPage` is invoked only against a blocked URL (guard path).
  ACCEPTED with explicit scope: live-URL qualification belongs to the
  P09b user-facing TesterArmy E2E, which is the mandatory gate for the
  P09b job lifecycle. No live behavior is claimed here.

## Four-bar verdicts

- **Correctness: PASS** — validate-then-capture-then-assemble-then-export
  order; each stage failure maps to its typed code with a closed cause;
  malformed worker output fails at the report gate; determinism pinned by
  test.
- **Parsimony: PASS** — one 110-line orchestration module, zero new
  evidence, zero new rules, zero dependency changes; injectable stages
  default to the real qualified implementations.
- **Product: PASS** — the paste-URL-to-report journey is now one call with
  typed errors; partial status, truncation gaps, graded clues, and
  never-installations framing flow through untouched.
- **Security: PASS** — unvalidated URLs never reach capture; causes carry
  closed codes only with a static message (leak-tested); guard, network,
  and isolation contracts untouched.

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.
