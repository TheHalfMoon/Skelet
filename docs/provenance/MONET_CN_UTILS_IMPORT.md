# G01-03b — First Qualified Donor Capability (`cn` Utility)

Status: candidate for exact-HEAD review; first donor code active in the app.

## Selection basis

`src/lib/utils.ts` was the single `selected-next` path in the G01-02c
dependency closure: a pure `cn()` helper over `clsx` + `tailwind-merge` with
zero corpus coupling and zero relative imports. Closure rule satisfied before
copying: every edge resolves to a pinned npm external.

| Identity | Value |
| --- | --- |
| Pinned donor | `monet-design/monet-registry@85c966f8d94572431bcbb4439f9fd7ea2a893321` |
| Donor path | `src/lib/utils.ts` |
| Donor Git blob | `a5ef193506d07d0459fec4f187af08283094d7c8` (169 bytes) |
| Skelet destination | `apps/web/lib/utils.ts` |
| Import mode | Verbatim; blob SHA preserved (verified post-copy) |
| Dependencies | `clsx@2.1.1`, `tailwind-merge@2.6.0` (exact; match donor pins) |
| Permissions | Code-only founder authorization; upstream license not verified |

Machine-readable record: `imports/monet-registry/accepted-code/cn-utils.json`.

## Integration proof

The utility is imported and executed by the Skelet landing page
(`apps/web/app/page.tsx`) and covered by `apps/web/tests/utils.test.mjs`
(conflict resolution, falsy filtering, array inputs, empty call,
pass-through). Full gate re-verified: lint, strict typecheck, 9/9 node
tests, production build, production smoke.

## Deliberate limitations

One utility, not a component library. No other donor path from the closure
is activated by this grain; all other decisions (reference-only, rejected,
quarantine) stand unchanged.
