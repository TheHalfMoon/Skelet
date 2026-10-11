# AF-SEC-00 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context read-only sessions over the migration 010,
the central gate, and every updated MCP/REST/pack/registry path, plus
the 7-test gate suite and the MCP/REST cross-workspace negatives.
Specialized agent providers unavailable: the judges used inline bars,
not independent provider models. This record MUST NOT be described as
independent provider models.

Review basis: base `5d47786…` through the candidate HEAD. Targeted runs:
DB gate suite 7/7, MCP 10/10, REST 5/5, root 39/39, ingest 8/8, assets
9/9, typecheck clean (db/assets/ingest/web), ESLint 0 errors.

## Must-fix (two defects found and closed pre-commit)

- **M1 — shared SQL placeholder across uuid and text columns.**
  The first draft reused one `$n` actor placeholder for both
  `workspace_members.user_id` (uuid) and `artifacts.owner_subject`
  (text); PGlite rejects `operator does not exist: text = uuid`.
  Fixed by pushing the actor twice with distinct placeholders so each
  has a single inferred type. Proved by REST search/asset suites
  returning 200 again.
- **M2 — dead-code helper.**
  The first draft exported `artifactActorPredicate` but no caller used
  it (registry inlines a V2 policy that also preserves the global
  corpus). Removed per OCR dead-code rules; gate suite still 7/7.

## Evidence-signal triage (closed pre-commit)

- First Jev pass: security 0.26, evidence 0.41 with no demonstrated
  defect. Triage re-read every retrieval path (search, resolve,
  get_object, pack export, save, preview-adjacent registry views) and
  confirmed each threads the actor: routes server-resolve the bearer
  identity, MCP requires a user for search/get_asset/get_object, packs
  authorize the collection first then gate each item with denied-skip,
  and save requires readability (anti-laundering). No open defect.

## Worth considering (one accepted advisory)

- **A1 — Jev scores are probabilistic, not verdicts.**
  Post-repair band (0.23–0.41) sits below the 0.5 threshold with zero
  blocking findings; branch-by-branch review shows every changed path
  covered by a committed negative test. ACCEPTED with the triage
  recorded here.

## Four-bar verdicts

- **Correctness: PASS** — gate predicate (public OR global-registry-kind
  OR workspace-membership with private-owner match) implemented once
  and embedded identically in search/resolve SQL; denied reads null
  with no oracle; pack export skips denied items; save denies
  laundering with the same generic error as missing artifacts.
- **Parsimony: PASS** — one gate module, one migration, threaded actor
  IDs through existing signatures; no second database, no new service,
  no donor import, no paid dependency.
- **Product: PASS** — exactly the AF-SEC-00 slice: forged IDs, guessed
  URIs, cross-workspace collections/packs/search/caches deny closed
  while the curated global registry stays readable and bytes stay
  serving-policy gated.
- **Security: PASS** — workspace isolation proved by 7 DB negatives
  plus MCP/REST forged-read/save negatives; search scope filters
  before rank; save-before-read circle closed by workspace-bound
  creation; no secret material; no new egress.

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.
