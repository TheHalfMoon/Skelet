# P10 Normalization Note — Skelet-Owned Taxonomy, Mobbin Reference-Only (Plan-Grounded)

Status: DISPOSITION NOTE with machine-checked traceability. Base: `46c30b2` (PR #136 merge).
Scope: close the P10 "Mobbin normalization note" and "screen gallery
wording" follow-ons named in the acceptance matrix. No code, config, or
dependency changed by this grain. Traceability is asserted offline by
`tests/test_p10_normalization.py`; CI never touches the network.

## What "Mobbin-learned normalization" means here

Plan section 14 (P10) asks for "Mobbin-learned screen/flow/hotspot
normalization without a runtime dependency on Mobbin services," and plan
line 753 forbids optimizing for Mobbin feature parity at the expense of
the agent-first contract ("an agent can discover, understand, cite, save,
and reuse design evidence better than through a screenshot-only library").

The Skelet-owned normalization vehicle is therefore:

- Canonical `Flow`/`FlowStep`/`Artifact` model with ordered steps,
  hotspot/action references, and screenshot evidence (`packages/db`).
- Authorized corpus importer with ledger-idempotent ingestion
  (`packages/ingest/src/corpus.ts`, AF-14a).
- Pattern taxonomy reads (`list_patterns`/`get_pattern`) plus UI
  (`/patterns`), gallery reads (`list_products`/`list_product_versions`)
  plus UI (`/gallery`), and the flow player (`/flows`) — the
  discover/inspect/compare journey without a Mobbin-clone screen wall.

## What is reference-only and never imported

- `UPSTREAMS.lock.yml` id `mobbin-mcp` (LanSynergy/mobbin-mcp): role
  `reference`, status `planned`, no commit pin, license `VERIFY_AT_IMPORT`,
  `imported_paths: []`. It records the taxonomy/workflow reference the
  Skelet-owned model was designed against. No Mobbin code, data, service,
  or trademark is imported, called, or required at runtime; activation
  would need its own pin, license verification, and import grain, none
  of which is planned.
- No `mobbin` import, fetch, or dependency exists anywhere in
  `packages/`, `apps/`, `scripts/`, or `tests/` (machine-checked below).
  Mobbin mentions in the repo are the plan's commercial thesis
  (price positioning, not a feature contract) and this note.

## Screen gallery wording (authoritative)

"Screen gallery" in P10 acceptance means the product/version gallery
plus flow player plus pattern taxonomy as implemented — the surfaces
where an agent or human discovers, inspects, and cites screens and
flows through stable `skelet://` URIs and MCP/REST parity. A
Mobbin-style masonry screen wall is explicitly not a launch requirement:
plan line 753 prioritizes the agent-first contract over Mobbin parity,
and every gallery/flow/pattern object already has a structured
agent representation. A dedicated screen-wall UI may be proposed as a
future enhancement with its own journey need, but its absence is not a
P10 gap.

## Trigger to re-evaluate

A measured journey need that the gallery/flow-player/patterns trio
cannot serve, plus owner-approved scope for either (a) a screen-wall UI
over the existing qualified reads (no new backend), or (b) a pinned,
license-verified Mobbin-reference import grain with rights clearance.
Neither is planned; the existing surfaces stay the contract.
