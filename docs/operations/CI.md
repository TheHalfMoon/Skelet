# Skelet CI Contract

Status: bootstrap CI contract introduced by G00-03.

## Exact-HEAD rule

Every pull-request CI job checks out `github.event.pull_request.head.sha` directly. Push jobs check out `github.sha`. The `bootstrap` job verifies that SHA through `scripts/ci_hygiene.py`; the `graft` job verifies it directly with Git before review tooling runs.

A status from a different commit is not evidence for the candidate HEAD.

## Required hosted jobs

### `bootstrap`

The bootstrap job must pass:

- exact-HEAD verification;
- repository hygiene and relative-link validation;
- large-file and binary-corpus guardrails;
- Python compilation for the current bootstrap code;
- the repository unit-test suite;
- the canonical upstream provenance-lock validator.

Formal application lint/typecheck/build commands replace the bootstrap compile step as the imported application toolchain becomes canonical. A placeholder must never be reported as a real typecheck or production build.

### `graft`

The Graft job uses pinned `@nanonets/graft@0.21.1` and must pass graph build and freshness checks on the exact candidate revision.

Graft output is architecture/change-impact evidence. It does not replace unit, integration, Jev, or Alibaba Open Code Review evidence.

## Review evidence

TypeSafe Jev and Alibaba Open Code Review remain governed pre-merge review gates under `GOVERNANCE.md`. They are not replaced by unrelated external reviewer statuses.

CodeRabbit, Cubic, Qodo, and similar reviewer statuses are not accepted as Skelet governance evidence even if GitHub displays them on a pull request.

## Failure behavior

The CI hygiene implementation is tested with deliberately invalid examples for:

- exact-HEAD mismatch;
- missing canonical files;
- broken relative Markdown links;
- trailing whitespace;
- NUL/non-UTF-8 text;
- malformed JSON;
- oversized files;
- oversized or excessive binary/media content;
- tracked generated/cache directories;
- tracked Python bytecode.

These tests are part of the hosted `bootstrap` job, so weakening a guardrail requires a reviewed code and test change.

## Binary policy

Git stores source code, manifests, metadata, and small qualified fixtures. Bulk screenshots, videos, model weights, archives, databases, and generated corpora belong in the configured asset/object store, not repository history.

The bootstrap limits are intentionally conservative and may be changed only through a governed grain with a documented need.
