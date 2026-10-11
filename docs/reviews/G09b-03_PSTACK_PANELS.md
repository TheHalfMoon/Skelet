# G09b-03 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context read-only sessions over the scope
resolver, its 7-test suite, and the one-line CI addition.
Specialized agent providers unavailable: the judges used inline bars,
not four independent provider models. This record MUST NOT be
described as four independent provider models.

Review basis: base `57751c1…` through the working tree. Targeted runs:
lens capture-scope 7/7, lens typecheck + ESLint clean.

## Must-fix

- **None.**

## Worth considering (two accepted advisories)

- **A1 — exact-host same-site is strict.**
  `www` versus apex (and any subdomain) counts as cross-site and is
  excluded with a gap. ACCEPTED as the safe default: widening to
  registrable-domain matching belongs to the traversal grain with
  explicit DNS-rebinding tests, not to silent scope expansion here.
- **A2 — depth budget is recorded, not yet enforced.**
  `maxDepth` rides in the inventory budgets for the traversal grain;
  resolution performs selection, not traversal. ACCEPTED with the
  boundary documented in the module header.

## Four-bar verdicts

- **Correctness: PASS** — mode semantics exact; request order kept
  for selected-pages, lexicographic order for sitemap; duplicates,
  cross-site, rejected, and over-budget candidates all surface as
  typed gaps; budget splits are even shares with a floor of 1;
  scope hash is stable across equivalent inputs.
- **Parsimony: PASS** — one pure module reusing `validateCaptureUrl`,
  one test file, one CI line; no network, browser, or storage.
- **Product: PASS** — bounded selection plus deterministic inventory
  with coverage gaps, exactly the G09b-03 resolution slice; traversal
  execution stays in its own grain.
- **Security: PASS** — SSRF shape policy reused per URL, https-only,
  exact-host containment, fail-closed unknowns, no silent drops.

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.
