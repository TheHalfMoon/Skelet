# AF-14c Coverage Analysis — Pack Reads and Compaction Disposition

Branch: `skelet/af14c-coverage`. Base: `530bd73` (PR #104 merge).
Scope: verification record only. No product code changed. This grain does
not close P12 by prose; it records measured re-verification plus the
domain-grounded reason a separate `get_reference_pack` verb needs no
existence.

## 1. Pack read intent: covered by `get_object` on both transports

Requirement intent (P08/P12): agents recover every evidence object by URI,
including reference packs with stale/tombstone semantics.

Implementation (pre-existing, re-verified below):

- MCP `get_object` (`apps/web/lib/mcp.ts`): artifact branch returns the
  canonical object; collection branch requires the `packs` capability and
  returns `exportReferencePack` with partial/warning semantics when
  denied or missing items were withheld.
- REST `getObjectRoute` (`apps/web/lib/rest.ts`): same two branches with
  deep-equal envelopes (artifact object; pack export with partial
  warnings).
- A separate `get_reference_pack` verb would duplicate the collection
  branch on both transports (gratuitous rename, explicitly out of
  bounds). No separate verb is built.

## 2. Compaction format intent: covered by `skelet/reference-pack/1`

Requirement intent (P12): a versioned, bounded evidence-compaction format
with citation, rights, freshness, and missing-data semantics.

Coverage: `exportReferencePack` (`apps/web/lib/reference-packs.ts`)
emits schema `skelet/reference-pack/1` with per-item URI/kind/title/rights
(citation + rights), `exportedAt` (freshness), `itemCount` versus
reference count with partial warnings (missing-data), skipping denied or
missing items so stale/retracted references never leak metadata. Round-trip
recovery by URI is proven on both transports.

## 3. Re-verification on this branch (real execution, 2026-10-14)

- `mcp-boards` + `boards`: 9/9 PASS (lifecycle, validation, isolation,
  handoff ledger, no-model independence, MCP/REST convergence, no-oracle
  denial).
- `boards-ui`: 5/5 PASS (real REST contracts, keyboard operability,
  provenance states).
- `envelope-parity` + `rest`: 19/19 PASS (includes partial-pack warnings
  without leaks and object recovery with pack gating).

## Remaining gaps (still open, not claimed)

- ArtCraft moodboard transplant decision (AC-02, needs measured
  adopt-vs-keep evidence against the Skelet-owned board).
- `get_changes` (P13), MCP Apps views (P12), per-item takedown automation
  beyond kit/board purge paths. Unchanged by this grain.
