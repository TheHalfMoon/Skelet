# G02-02 — Worker Shell and Environment Contract

Status: candidate for exact-HEAD review; shell only, no jobs yet.

## Scope

`apps/worker` (`skelet-worker@0.1.0`): a dependency-free Node.js worker
shell sharing the pnpm workspace and strict TypeScript base with the web
application. It establishes the environment contract and command surface that
later ingestion/capture/analysis jobs will extend. The web application is
unchanged in behavior.

## Environment contract (`src/env.ts`)

| Variable | Values | Default |
| --- | --- | --- |
| `SKELET_ENV` | `development` \| `test` \| `production` | `development` |
| `SKELET_WORKER_CONCURRENCY` | decimal integer 1–32 | `4` |
| `SKELET_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` | `info` |

Unknown `SKELET_*` keys fail closed (typos are rejected, not ignored);
non-Skelet keys pass through untouched. All rules are pinned by
`apps/worker/tests/env.test.mjs`.

## Command surface (`src/cli.ts`, `src/index.ts`)

- `health`: validates the environment and prints
  `{status: "ok", service: "skelet-worker", version, env}` as JSON.
- `start`: validates the environment and reports readiness; states explicitly
  that no jobs are registered yet.
- Unknown/missing command: usage text, exit 2. Invalid env on `start`:
  exit 1. The runner (`index.ts`) is a thin wrapper over a pure,
  unit-testable `run()`.

## Workspace layout note (G02-01)

The reshape grain required moving qualified web code into `apps/web` with a
pnpm workspace. The Skelet shell was born in place (G01-03a) already
satisfying that layout, so no move was necessary: no behavior changed, and
the workspace file, frozen lockfile, and per-app toolchains are in force.
This grain extends the same layout with `apps/worker` and shared strict
configuration.

## Qualification

```powershell
pnpm install --frozen-lockfile
pnpm --dir apps/worker lint
pnpm --dir apps/worker typecheck
node --experimental-strip-types --test "apps/worker/tests/*.test.mjs"
pnpm --dir apps/worker start health
```

GitHub Actions runs the same gate as the `worker` job against the exact PR
HEAD. The web `test` script and `web` job suites now also include the worker
tests.
