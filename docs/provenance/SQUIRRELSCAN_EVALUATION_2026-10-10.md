# Squirrelscan Adapter Evaluation (G09-07)

Date: 2026-10-10.
Upstream: https://github.com/squirrelscan/squirrelscan.
Pinned commit: `b0e209c44c14ef5340de030c36b3b075fa49a6ff` (verified HEAD via
`git ls-remote` at evaluation time; shallow clone confirms the same SHA).
License: MIT (verified via GitHub API and the LICENSE file at the pinned
commit; THIRD_PARTY_NOTICES.md and TRADEMARKS.md present upstream). No source
code was imported in this grain.

## What was inspected

- Monorepo layout: `apps/cli` plus packages `api-client`, `audit-engine`,
  `cloud-client`, `config`, `core-contracts`, `crawler`, `fetchers`,
  `parser`, `report`, `rules`, `synthetic-site`, `tech-detect`,
  `threat-intel`, `utils`, `waf-detect`. Toolchain is `bun@1.4.0`
  workspaces with `bun test`; root scripts include release, changelog, and
  third-party-notice generation.
- `packages/rules`: the upstream-described 301+ audit-rule set (SEO,
  performance, security, accessibility, agent experience) with per-rule unit
  tests (145 `*.test.ts` files observed in the pinned clone). Verified test
  pattern (`dom-size.test.ts`): rules run synchronously on a `RuleContext`
  built from an HTML string via `@squirrelscan/parser` — no network inside
  the rule boundary.
- `packages/audit-engine/src/adapter.ts`: bridges crawler storage data to
  rule/report input using workspace-internal `@squirrelscan/*` imports and
  the `effect` library; sibling modules include cloud fetchers, cloaking
  probes, endpoint discovery, and external checkers.
- Live-network surface: `crawler`, `fetchers`, `cloud-client`,
  `threat-intel`, `waf-detect`, endpoint discovery, and cloaking probes all
  perform active fetching/probing of third-party sites.

## Compatibility verdict

The deterministic rule shape (HTML string plus headers in, graded
checks out) is compatible in principle with Skelet's offline model; the
surrounding system is **rejected** for Lens integration:

1. The audit engine is inseparable in practice from its crawler storage,
   workspace-internal packages, `effect` runtime, and bun toolchain —
   incompatible with Skelet's pnpm/Node offline pipeline. Importing it
   would transplant a second runtime, not an adapter.
2. Live crawler/fetchers/cloud services perform active probing outside
   Skelet's SSRF-guarded DNS-pinned ingress and violate the
   no-mandatory-external-service rule.
3. Per the canonical donor decision (DEFER/ADAPT), Lens must work with this
   provider disabled; the required path stays fully deterministic and local.

## Reuse shortlist (reference only, no import)

1. Selected deterministic rules (DOM size, meta/SEO, content-signal checks)
   as design reference for a future Skelet-owned QA layer operating
   exclusively on SSRF-guarded capture evidence (HTML plus response
   headers), with Skelet's own fixture tests as proof.
2. Rule-test pattern (HTML string in, graded checks out, no network) as the
   contract shape for any future Skelet QA rule.

## Rights flags for any future QA grain

- Rule ports must be clean-room Skelet-owned code; no `@squirrelscan/*`
  package import, no `effect` runtime transplant, no bun toolchain.
- Upstream THIRD_PARTY_NOTICES.md/TRADEMARKS.md must be re-checked at import
  time for any transitive content carried by a port.

## Decision

EVALUATED, NOT IMPORTED. The adapter decision stays DEFER/ADAPT with
narrowed scope: deterministic-rule reference only, optional provider, Lens
required path unaffected and fully local.
