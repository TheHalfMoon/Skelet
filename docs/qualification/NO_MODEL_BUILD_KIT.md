# No-Model Qualification: Lens URL to Build-Ready Kit (AF-05g-i)

## Verdict

The supported Lens-to-Build-Kit chain runs with **zero mandatory paid AI
APIs, paid model providers, GPUs, SaaS, online inference, or embeddings**.
Verified on the committed tree; guard test
`packages/lens/tests/no-paid-path.test.mjs` fails future regressions that
add a provider reference to the chain path.

## What was audited (chain path, all local)

- Deterministic capture (pinned `playwright-core` headless Chromium,
  isolated child process, SSRF/DNS-rebinding/redirect guards), report
  assembly, export surface, kit manifest, kit packaging (self-contained
  ZIP + parse round-trip), starter synthesis (generated React/Next.js +
  Tailwind skeletons, no external URLs), durable store
  (`packages/db/src/build-kit.ts`), REST/MCP/UI serving layers.
- `packages/lens/src` reads **zero** environment variables: no credential
  lookup, no env-gated provider switch exists on the chain path.
- The single `packages/providers` mention on the chain path is prose in a
  comment plus a local descriptor declaring `egress: "none"` and
  `costClass: "free-local"` — structural mirror, no runtime dependency
  (triaged honestly when the new guard flagged it; guard now asserts
  module loads, not prose).
- The UI's only network calls are same-origin `fetch` to our own REST
  routes (relative `/api/` paths); absolute-URL fetch is guard-forbidden.

## Reproducible verification

Prerequisites: Node 22.23.1, pnpm 9.12.0, frozen install, pinned
Chromium headless shell (all free, local compute only).

```bash
pnpm install --frozen-lockfile
node packages/lens/node_modules/playwright-core/cli.js install chromium-headless-shell
node --experimental-strip-types --test packages/lens/tests/no-paid-path.test.mjs
node --experimental-strip-types --test packages/lens/tests/kit-fixture-chain.test.mjs packages/lens/tests/three-page-fixture.test.mjs
node --experimental-strip-types --test packages/no-model/tests/no-model.test.mjs
SKELET_NO_MODEL=1 pnpm --dir apps/worker start health
```

Expected: all green with no provider credentials in the environment
(the chain tests run exactly that way in CI).

## Cost disclosure (honest, not zero-cost-everywhere)

- No per-run API, model, embedding, or SaaS charge on the minimal
  deterministic path.
- Genuine remaining costs are operator-side and disclosed, not hidden:
  local compute (CPU/RAM for Chromium + builds), disk for captures and
  artifacts, and whatever hosting/egress the operator's own deployment
  incurs. The fixture captures stay offline and synthetic; capturing a
  real public URL uses the operator's own bandwidth under scope budgets.
- No feature degrades for lack of a paid key because no chain feature
  takes one: there is nothing to degrade. If a future integration adds
  an optional provider, it must ship disabled-by-default with explicit
  degradation, or this qualification is void.

## Optional integrations

None on the chain path today. Handoff to external editors/generators
(Lilac/OpenPencil/Ineractive class) remains allowed **only** via a
qualified versioned adapter, never as a chain dependency (R4 gate).
