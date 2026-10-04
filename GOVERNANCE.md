# Skelet Governance

Status: canonical repository governance

## Source of Truth

The canonical implementation program is `docs/IMPLEMENTATION_PLAN.md`.

This file defines how implementation work is executed, reviewed, merged, and closed. If a local instruction conflicts with this governance, stop and resolve the conflict before changing canonical code.

## Language

All repository content, including code, comments, commands, commits, branches, pull requests, issues, specs, evidence, reports, and research notes, is English only.

## Grain Discipline

Implementation proceeds by bounded grains from the canonical plan.

Every grain must declare:

- grain ID and objective;
- exact canonical base SHA;
- branch name;
- files and public contracts in scope;
- dependencies that must already be canonical;
- qualification evidence required before merge.

Do not combine unrelated donor imports, schema work, UI redesign, provider integration, and public API changes into one grain.

## Branches and History

Branch naming pattern:

`skelet/pXX-gYY-short-name`

History rules:

- ordinary merge commits only;
- no rebase of governed branches;
- no force-push;
- no history rewriting;
- do not merge from a stale base when the grain's dependency assumptions have changed;
- merge only the exact reviewed HEAD.

## Mandatory Graft Gate

Graft is mandatory for governed implementation work.

Before implementation where a graph exists:

1. run `graft check` to verify graph freshness;
2. rebuild with `graft build` if stale;
3. use Graft queries/maps as needed before changing unfamiliar code.

Before review:

1. run `graft build` on the exact candidate HEAD;
2. run `graft check` and require success;
3. run `graft blast --base <canonical-base> --format markdown` or the equivalent exact-base blast-radius command;
4. retain the relevant output in the grain evidence or PR record.

A stale or failed Graft graph is a blocking review condition when the repository contains indexable implementation code.

For documentation-only bootstrap grains where Graft has no indexable implementation code, record that fact explicitly rather than fabricating a graph result.

## Mandatory TypeSafe Jev Gate

TypeSafe Jev is mandatory for every governed diff.

Jev review must:

- bind to the exact base SHA and exact candidate HEAD;
- cover every changed hunk or the complete changed artifact as appropriate;
- evaluate correctness, security/privacy, reliability, compatibility, test/evidence gaps, and grain/scope integrity;
- produce machine-readable evidence;
- contain zero unresolved blocking findings before merge.

If Jev cannot run, the grain is blocked. Do not substitute an invented or historical result.

## Mandatory Alibaba Open Code Review Gate

Alibaba Open Code Review is mandatory for every governed code or configuration diff and for repository-governance changes that affect implementation behavior.

Preferred mode is an exact-diff review against the canonical base using a configured OCR provider.

If no OCR provider credential is available, the official `ocr delegate` workflow may be used only when:

- OCR itself resolves the reviewable files and applicable rules;
- the delegated review is executed against the exact diff;
- findings and coverage are recorded as evidence;
- the review does not claim to be an LLM-backed OCR scan.

If neither configured OCR review nor valid OCR delegation can be completed, the grain is blocked.

Zero unresolved blocking OCR findings are allowed before merge.

## Review Order

Default qualification order:

1. implementation-local tests and static checks;
2. Graft freshness and blast-radius review;
3. TypeSafe Jev exact-diff review;
4. Alibaba Open Code Review exact-diff or valid delegated review;
5. GitHub CI on the exact PR HEAD;
6. mergeability and dependency revalidation;
7. ordinary merge commit;
8. post-merge verification on canonical `main`.

A later passing gate does not erase an earlier unresolved failure.

## Evidence Rules

Never fabricate:

- command output;
- test results;
- CI status;
- review findings;
- SHAs;
- provider status;
- runtime/device state;
- provenance or rights evidence.

Evidence must bind to exact immutable identities wherever possible.

Review reports must state whether a tool actually executed, delegated, failed, or was unavailable.

## Pull Requests

Every implementation PR must include:

- grain ID;
- exact base SHA;
- exact head SHA;
- scope summary;
- changed contracts;
- local qualification results;
- Graft status/blast summary;
- Jev status and evidence location;
- Alibaba OCR status and evidence location;
- CI status;
- known limitations or deferred work.

A PR is not complete merely because it was merged.

## Canonical Closeout

A grain becomes canonical only after:

1. normal merge commit lands on `main`;
2. the merge SHA is observed from GitHub;
3. required post-merge checks pass against that canonical state;
4. the closeout record names the merge SHA and evidence.

## Donor and Provenance Governance

User-provided permission to use a donor is treated as authorization for the stated scope, but every import must still preserve provenance and distinguish source-code rights from dataset, asset, model-weight, service, brand, and trademark rights.

No donor import is identified only by a moving branch name. Pin an immutable commit, release, or content hash at execution time.

Use donors to delete work, not to import unnecessary complexity.

## Cost Governance

Do not make a paid API, managed AI provider, paid crawler, paid search service, paid vector database, mandatory GPU, or mandatory cloud-specific service a launch requirement without an explicit architecture decision supported by measured value.

## Stop Conditions

Stop the current grain before merge if any of the following is true:

- dependency or base SHA assumptions are stale;
- scope expanded beyond the grain contract;
- Graft freshness/blast evidence is invalid or required but missing;
- Jev has an unresolved blocking finding or cannot run;
- Alibaba OCR has an unresolved blocking finding or cannot be validly completed;
- required tests or CI are failing;
- provenance/rights are ambiguous for material imported content;
- a security boundary is known to fail.

Fix the grain or split it. Do not weaken the gate to preserve schedule.
