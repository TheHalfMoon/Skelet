# Dembrandt Adapter Evaluation (G09-04)

Date: 2026-10-10.
Upstream: https://github.com/dembrandt/dembrandt.
Pinned commit: `d2d570706dbd83d6531225c67923872d813be1a4` (verified HEAD via
`git ls-remote` at evaluation time; shallow clone confirms the same SHA).
Version at pin: 0.38.0. License: MIT (verified via GitHub API and the LICENSE
file at the pinned commit). No source code was imported in this grain.

## What was inspected

- `package.json`: runtime dependencies `@modelcontextprotocol/sdk@1.30.0`,
  `chalk@^6.0.0`, `commander@15.0.0`, `ora@9.4.1`,
  `playwright-core@1.62.1`, `zod@4.5.4`; optional `onnxruntime-node@1.29.0`;
  optional peer `playwright@^1.60.0`. Node engines `>=18.0.0`.
- `lib/extractors/index.ts`: the extraction core operates on a live
  Playwright `Page` from Dembrandt's own browser, with network access,
  web-font loading, JS execution, consent dismissal, and human-mimicry input
  simulation (Fitts-model mouse motion, tremor, Gaussian timing).
- `lib/extractors/guard.ts`: per-extractor fault isolation with fallbacks.
- `lib/colors.ts`: pure color-conversion utilities (sRGB/XYZ/Lab, Bradford
  adaptation), no browser dependency.
- `lib/dtcg/validate.ts`: W3C DTCG format validator, no browser dependency.
- `lib/formatters/dtcg.ts`, `lib/formatters/markdown.ts`: export formatters
  (browser independence to be confirmed per file before any reuse).

## Compatibility verdict

Dembrandt's browser-driven extractors are **incompatible** with Skelet G09-03
offline capture. Skelet renders untrusted HTML with JavaScript disabled, all
network routes denied, and offline mode enforced; Dembrandt requires a live
networked page. Running Dembrandt's own browser would bypass Skelet's
SSRF-guarded DNS-pinned ingress and is therefore rejected as an integration
path. The human-mimicry input simulation is additionally inconsistent with
Skelet's deterministic-capture stance.

## Reuse shortlist (selective, pure functions only)

1. `lib/dtcg/validate.ts` — DTCG conformance validation for Skelet token
   output. No browser dependency observed.
2. `lib/colors.ts` plus `lib/color-parse.ts` — perceptual color math for
   token clustering. `color-parse.ts` declares itself dependency-free with
   no imports (verified 2026-10-10); `colors.ts` imports only
   `color-parse.js` and types. No browser dependency in either file.
3. `lib/formatters/dtcg.ts` — DTCG export shape. Requires per-file
   browser-independence confirmation before reuse.

Skelet's existing deterministic extractor (`packages/lens/src/design-tokens.ts`,
G09-02) remains the token source of truth; Dembrandt material may only inform
validation and export shapes, never replace Skelet's offline pipeline.

## Version and rights flags for any future import grain

- `playwright-core@1.62.1` vs Skelet pinned `playwright-core@1.56.1`:
  version skew must be resolved (upgrade qualification or vendored isolation)
  before any Dembrandt-derived runtime dependency lands.
- `lib/ml/model.onnx` plus optional `onnxruntime-node`: model-weight rights
  and CPU cost must be evaluated separately; excluded from this shortlist.
- `chalk`/`commander`/`ora` CLI affordances must not enter Skelet runtime.
- Full `playwright` (non-core) peer dependency must never enter Skelet;
  headless-shell via pinned `playwright-core` remains the only browser path.

## Decision

EVALUATED, NOT IMPORTED. The adapter decision stays ADAPT with narrowed
scope: DTCG validation/export and color math only. Browser extractors are
explicitly out of scope for Skelet Lens.
