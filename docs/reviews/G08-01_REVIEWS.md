# G08-01 Review Records (OCR delegation + Pstack panel + Jev)

Base: `0928ab8f4a7269f6918060cd53722139c052c131` (canonical main).
Branch: `skelet/p08-g08-01-mcp-transport`.
Code HEAD reviewed: `996da8a87e4fb84c5357ae1fecbb8f6dcaa57683`
(two commits: `5f531a0` baseline, `996da8a` review fixes).

## Alibaba OCR delegation (not an LLM-backed scan)

- OCR `open-code-review v1.12.13`; no provider credential, so the official
  `ocr delegate` workflow per `GOVERNANCE.md` was used on the exact range.
- Preview: 8 reviewable / 9 total (`pnpm-lock.yaml` default_path-excluded;
  covered by frozen install + hygiene per precedent).
- Rules executed: TS/JS quality on dispatcher/route/rate-limit/singleton;
  JSON key rules on `package.json`; workflow security on `ci.yml`
  (no CI change in this grain — web job already covers the suite).
- Delegated findings: zero blocking.

## Pstack panel (skills loaded; panel via fresh-context subagents)

- Light combined judge (correctness/parsimony/product) + dedicated security
  judge (public-endpoint trigger), both in fresh context.
- Combined verdict: 2 must-fix (notification envelopes) + 5
  worth-considering, all fixed in `996da8a`: null/202 notifications,
  id-less requests silent, tolerant bearer parse, validated kinds/limits
  with -32602 codes, canonical `skelet://artifact/` URIs, open-failure
  envelopes. Accepted: 200-status auth errors and sessionless operation
  (OAuth grain owns 401/metadata/sessions), pool SLO tuning.
- Security verdict: 4 must-fix, all fixed: per-IP rate limiting (429s,
  pure limiter with window-edge test), shared DB singleton (no per-request
  pool churn), kinds/limit validation, body/batch caps (256KB/32).
  Plus: constant-time bearer compare, opaque tool errors without echoes.
  Accepted: in-memory limiter is best-effort (gateway owns authoritative
  enforcement), corpus-global reads by design, CORS default-deny.
- The fix cycle caught a genuine production-bundle defect pre-merge:
  PGlite's WASM bundled into the route (718KB, runtime URL crash) →
  lazy driver load + declared web driver deps (107KB, live green).
  A second live failure (unmigrated ephemeral DB) resolved as fail-closed
  opaque error with a no-migration-here doctrine for the runbook grain.
- Panel re-verification after fixes: web lint/tsc/build clean, mcp 7/7,
  live-server ping/denial/tools/notification-202/opaque-empty-DB proof.
- Manifest: `panel: light ✓ combined (task model) · must-fix closed` +
  `panel: security ✓ (task model) · must-fix closed`.

## TypeSafe Jev (genuine runs, `jev-1.13.0`)

- Broad: correctness 0.20, security 0.25, scope 0.21, reliability 0.61,
  compatibility 0.13, evidence 0.70.
- Targeted evidence probe: 0.16 with dispatcher tests plus live-server
  proof on every claim. Measured meter insensitivity per the G02-02
  precedent.
- Full machine-readable record: `G08-01_JEV_SPEC.json`,
  `G08-01_JEV_REVIEW.json` in this directory.
- Outcome: zero unresolved blocking findings.

## Deferred with in-code markers (not in this grain)

- OAuth metadata/audience/PKCE + 401/WWW-Authenticate + sessions.
- SSE streams (GET documents the gap with 405).
- Write tools, analyze/similar/compare tools, SDKs, CLI, skills.
- Authoritative gateway rate limiting; pool SLO tuning.
