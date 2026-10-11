# AF-03b PStack Panels (manual fresh-context fallback)

- PStack binary unavailable in this environment (`which pstack` not found).
  No new paid model provider was activated to satisfy PStack. This record
  uses the repository-permitted manual fresh-context four-bar review
  fallback. It MUST NOT be described as an independent-model review.

## Correctness — PASS

- Canonical `agent-contract.ts` implements the frozen `skelet.agent.v1`
  envelope (schema_version, request_id 1..128, status complete/partial,
  result object, cursor ≤256, warnings ≤16, typed error, provenance with
  five evidence modes) and the 13-code catalog with one HTTP/MCP mapping.
- MCP `tools/call` domain payloads return success envelopes in
  `result.content[0].text`; domain failures return JSON-RPC errors with
  the same canonical code plus `data.envelope`. Transport codes preserved
  (-32602 validation, -32001 auth, -32000 domain, -32601 unknown tool).
- REST v1 assets/objects return envelope bodies with mapped HTTP statuses
  (200/202/400/401/403/404/409/429/503/500/504) and `X-Request-Id` support.
- Pagination is deterministic (`order by title, id`, offset via opaque
  base64url cursor, `limit+1` lookahead, `INVALID_INPUT` on malformed
  cursor/limit). Rights follow actor-gate-then-rights order so private
  artifacts never upgrade to `RIGHTS_RESTRICTED`.
- Must-fix closed pre-commit: TypeScript `exactOptionalPropertyTypes`
  violations, `AgentEnvelope` value-import under `--experimental-strip-types`,
  unknown-tool code preserved as `-32601`, public-plus-restricted DB check
  constraint honored in tests.

## Parsimony — PASS

- One canonical module (`agent-contract.ts`) owns envelopes, mapping,
  cursors, request IDs, capabilities, and provenance. MCP and REST both
  delegate; no duplicated serialization or error-policy forks.
- Registry change is additive (`offset?` with `OFFSET` in one query, no
  new table). SDK change is additive (envelope unwrap with bare-shape
  fallback). No new package, migration, UI, billing, or donor import.
- Accepted advisory: `successEnvelope` forces `complete` when warnings
  exist without explicit `partial:true` except when the caller passes
  `partial:true` (pack withholding). Cursor-only pagination stays
  `complete` with a cursor, which matches the frozen schema.

## Product — PASS

- Tool names, REST paths, URI scheme (`skelet://artifact|collection`),
  and server-resolved auth are unchanged. SDK still reads bare shapes.
- All 14 required behaviors are wired where applicable: envelopes,
  URIs, request IDs, typed success/failure, structured codes, auth,
  rights-restricted (403 after gate), missing-resource (404 shared),
  validation (400), redaction, pagination/cursors, partial/warnings (pack
  withholding), capability-disabled (`SKELET_DISABLED_CAPABILITIES` →
  `PROVIDER_DISABLED` 503), job codes (catalog + helpers, no async jobs
  in this grain), and MCP↔REST mapping.
- 13 new parity tests plus 15 updated MCP/REST tests use real PGlite
  DB-backed dispatch and route functions (no mocked handlers).

## Security — PASS

- Failure messages are static catalog strings; validation messages are
  bounded pre-approved safe strings. No stacks, secrets, paths, or DB
  details in envelopes, warnings, provenance, or cursors.
- Unknown and denied share `FORBIDDEN_OR_NOT_FOUND` (404 / -32000) with
  identical messages; withheld pack items emit a generic warning without
  naming which items. Request IDs reject control characters. Cursors are
  opaque offsets with no IDs or filters inside beyond the offset.
- Zero must-fix remaining. One accepted advisory: MCP transport auth and
  rate-limit errors now include `data.envelope` while parse/method errors
  stay bare protocol errors for backward compatibility.
