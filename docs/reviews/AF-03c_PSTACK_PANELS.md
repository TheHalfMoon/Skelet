# AF-03c PStack Panels (manual fresh-context fallback)

- PStack binary unavailable in this environment (`which pstack` not found).
  No new paid model provider was activated to satisfy PStack. This record
  uses the repository-permitted manual fresh-context four-bar review
  fallback. It MUST NOT be described as an independent-model review.

## Correctness — PASS

- MCP `initialize` negotiates all 4 protocol versions via params and the
  `MCP-Protocol-Version` header, falling back to `2026-07-28` for unknown or
  missing values, and advertises `skelet.capabilities {packs, registry}` plus
  the frozen `skelet.agent.v1` contract without changing the core
  `protocolVersion/serverInfo/capabilities.tools` shape.
- `tools/call` accepts optional `requestId` (echoed in the envelope, malformed
  values fail `INVALID_INPUT`) and `idempotencyKey` (validated, malformed
  values fail `INVALID_INPUT`). `save_reference` retries are naturally
  idempotent via `ON CONFLICT`; `create_reference_pack` dedupes sequential
  retries via the `pack_idempotency (user_id, key) -> collection_id` ledger
  (migration 011) and converges concurrent same-key creates on the ledger
  winner with best-effort orphan cleanup.
- REST `GET /api/v1/assets`, `GET /api/v1/assets/[id]`, and
  `GET /api/v1/objects` echo the canonical envelope `request_id` as the
  `X-Request-Id` response header; MCP `POST /mcp` echoes the negotiated
  protocol version and any supplied `X-Request-Id`.
- TS and Python SDKs unwrap both the versioned envelope and the pre-AF-03b
  bare shape, expose cursor pages (`searchAssetsPage` / `search_assets_page`
  with `cursor`/`request_id`/`warnings`), forward `X-Request-Id`, and map
  envelope `error.code`/`retryable` to the SDK taxonomy (`RIGHTS_RESTRICTED`
  -> forbidden, `FORBIDDEN_OR_NOT_FOUND` -> not-found, `RATE_LIMITED`/
  `QUOTA_EXCEEDED` -> rate-limited with `retryable=true`).
- Must-fix closed pre-commit: concurrent same-key race converged on one URI
  (orphan deletion best effort), broad Python `except Exception` narrowed to
  `(ValueError, OSError)`, unused `sys` import dropped.

## Parsimony — PASS

- One canonical contract module owns envelopes, cursors, request IDs,
  idempotency-key validation, capabilities, and retryable mapping; MCP and
  REST both delegate. The ledger is one narrow table with two helpers
  (`findPackForIdempotencyKey`, `claimPackIdempotency`); no second database,
  no new service, no donor import.
- Registry change is zero (offset pagination reused). SDK changes are
  additive (new page methods, optional `requestId`/`cursor` params, extended
  `SdkError` fields with backward-compatible defaults). Test-server and
  stdio-bridge scripts are test-only helpers reusing the real dispatch paths.
- Accepted advisory: `tools/list` still lists all 6 tools when a capability
  is disabled; negotiation happens via `initialize.skelet.capabilities` plus
  `PROVIDER_DISABLED` on call with a REST fallback, preserving older clients
  that ignore the new `skelet` field.

## Product — PASS

- Tool names, REST paths, URI scheme (`skelet://artifact|collection`), and
  server-resolved auth are unchanged. Old SDK callers that omit `cursor` /
  `requestId` keep working; old MCP clients that omit `requestId` /
  `idempotencyKey` keep working.
- All 12 required behaviors are wired: version negotiation, auth/token/
  permissions/boundaries, TS SDK, Python SDK/CLI, envelope parity,
  request IDs + typed errors, cursor pagination, idempotency + retry hints,
  capability negotiation with unsupported-extension `-32601` fallbacks, three
  independent wire clients, cross-workspace/rights negatives, and
  cross-client URI recovery (MCP create -> SDK read on the same server in
  both Node and Python suites, plus stdio pack round-trip).
- 8 Node fetch HTTP tests + 4 Python urllib tests + 3 stdio pipe tests use
  real PGlite-backed dispatch over real TCP/pipes (no mocked handlers); the
  three stacks (fetch vs urllib vs stdio) are genuinely independent
  runtimes/transports, not three wrappers of one client.

## Security — PASS

- Failure messages stay static catalog strings; validation messages are
  bounded pre-approved safe strings. No stacks, secrets, tokens, paths, or
  DB details in envelopes, warnings, provenance, cursors, keys, or headers.
- Unknown and denied share `FORBIDDEN_OR_NOT_FOUND` with identical messages;
  withheld pack items emit a generic warning without naming which items.
  Request IDs and idempotency keys reject control characters and whitespace;
  cursors stay opaque base64url offsets. Idempotency keys are per-user so one
  actor cannot recover another's pack through a guessed key.
- Zero must-fix remaining. One accepted advisory: Graft blast undercounts
  spawned-process coverage (HTTP subprocess + stdio pipes) by design; the
  wire suites above are the real coverage evidence for those paths.
