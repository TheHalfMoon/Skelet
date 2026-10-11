# AF-SEC-00 Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: AF-SEC-00, branch `skelet/af-sec00-actor-scope`, base
  `5d4778636de8fbb3c8ef71efbfe46d473f8e97e3`.
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM
  provider credential is configured in this environment, so the official
  `ocr delegate` workflow was used per `GOVERNANCE.md`.
- `ocr delegate preview --from <base> --to HEAD`: 31 reviewable / 33 total.
  The 2 excluded files are this record's sibling markdown panels
  (`AF-SEC-00_OCR_DELEGATION.md`, `AF-SEC-00_PSTACK_PANELS.md`),
  excluded by OCR itself (`unsupported_ext`) and covered by the inline
  four-bar panel and the green suites instead.
  Reviewable: `.github/workflows/ci.yml` (+1/-0),
  `apps/web/app/api/v1/assets/[id]/route.ts`,
  `apps/web/app/api/v1/assets/route.ts`, `apps/web/lib/mcp.ts`,
  `apps/web/lib/reference-packs.ts`, `apps/web/lib/rest.ts`,
  `apps/web/tests/mcp.test.mjs`, `apps/web/tests/rest.test.mjs`,
  `docs/reviews/AF-SEC-00_JEV_REVIEW.json`,
  `docs/reviews/AF-SEC-00_JEV_SPEC.json`,
  `packages/assets/src/registry.ts`,
  `packages/db/migrations/010_artifact_actor_scope.down.sql`,
  `packages/db/migrations/010_artifact_actor_scope.up.sql`,
  `packages/db/src/artifact-access.ts`, `packages/db/src/collections.ts`,
  `packages/db/src/graph.ts`,
  `packages/db/tests/artifact-access.test.mjs`,
  `packages/db/tests/auth.test.mjs`, `packages/db/tests/billing.test.mjs`,
  `packages/db/tests/build-kit.test.mjs`,
  `packages/db/tests/collections.test.mjs`,
  `packages/db/tests/db-foundation.test.mjs`,
  `packages/db/tests/graph.test.mjs`, `packages/db/tests/jobs.test.mjs`,
  `packages/db/tests/pg-build-kit.test.mjs`,
  `packages/db/tests/pg-graph.test.mjs`,
  `packages/db/tests/pg-integration.test.mjs`,
  `packages/db/tests/pg-workflows.test.mjs`,
  `packages/db/tests/workflows.test.mjs`,
  `packages/db/tests/workspaces.test.mjs`,
  `packages/ingest/src/pipeline.ts`.
  The follow-up test-alignment commit only adds migration-list
  assertions (`010_artifact_actor_scope`) to 11 test files — same
  TS/JS rule group, no new rule groups, no product change.
- Delegated rules executed against the exact diff
  (`ocr delegate rule` groups: workflow rules; TS/JS rules; SQL default
  rules; JSON key-spelling rules):
  - Group workflow (ci.yml): one added test path inside the existing DB
    `run:` block; no new expression, secret, action, permission,
    schedule, or matrix leg. No finding.
  - Group TS/JS (libs, routes, tests): no `var`, no new `==`/`!=`
    (remaining `== null` lines are pre-existing canonical style outside
    this diff's hunks), no `any`, no `eval`/`Function`/dynamic import,
    no network, no filesystem access, no secret material, no prototype
    modification; every new export is consumed (gate by collections,
    MCP, REST, packs; actor search/resolve by MCP/REST/tests); no dead
    branches. One rule finding applied pre-commit: R-DeadCode unused
    `artifactActorPredicate` helper removed from `artifact-access.ts`;
    post-repair typecheck clean and gate suite still 7/7. No remaining
    finding.
  - Group SQL (010 up/down): static DDL only (columns, index, checks);
    no dynamic SQL, no secret, permission validation complete
    (owner-needs-workspace, owner format); migration runs inside the
    canonical advisory-locked transaction; nullable-column add is
    metadata-only. No finding.
  - Group JSON (Jev spec/review): key spelling checked; values are
    evidence records. No finding.
- Findings: zero unresolved blocking findings. This record MUST NOT be
  described as an LLM-backed OCR scan.
