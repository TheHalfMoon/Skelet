# G01-03a — Skelet-Owned Web Application Shell

Status: candidate for exact-HEAD review; first runnable Skelet application.

## Scope

A clean Skelet-owned Next.js workspace with zero donor code, donor branding,
or donor data. No `src/components/`, `public/`, `data/`, or generated corpus
material was copied; the landing page and health endpoint are written for
Skelet in English.

| Decision | Value |
| --- | --- |
| Next.js | `15.5.27` |
| React / React DOM | `19.3.0` |
| TypeScript | `5.9.3` (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) |
| ESLint | `9.39.5` with `eslint-config-next@15.5.27` via `FlatCompat` + `@eslint/eslintrc@3.3.7` |
| Node (CI) | `22.23.1`; engines require `>=20.9.0` |
| Package manager | `pnpm@9.12.0` (pinned; frozen lockfile committed) |

## Contract

- `GET /api/health` returns `200` with
  `{status: "ok", service: "skelet-web", version}` (`version` read from the
  web package manifest at runtime; the payload builder is framework-free so
  the contract is unit-testable without the Next runtime).
- `GET /` returns `200` and identifies Skelet.

## Qualification (mechanical gate)

```powershell
pnpm install --frozen-lockfile
pnpm --dir apps/web lint
pnpm --dir apps/web typecheck
node --experimental-strip-types --test tests/node/ apps/web/tests/
pnpm --dir apps/web build
node scripts/smoke-web.mjs 3103
```

GitHub Actions runs the same gate as the `web` job against the exact PR
HEAD, alongside `bootstrap`, `graft`, and `monet-screenshot-queue`.

## Deliberate limitations

This is an application shell, not the product: no database, no auth, no
ingestion, no search, no agent interfaces. Those arrive in dependency order
(P02 onward). The isolated donor `ScreenshotQueue` (G01-02b) is not wired
into the shell; provider integration is G01-03b and later.
