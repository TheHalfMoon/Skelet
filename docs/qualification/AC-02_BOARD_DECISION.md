# AC-02 Reference-Board Adopt-vs-Keep Decision — KEEP Skelet-Owned (Measured)

Status: DECISION RECORD with machine-checked measurements. Base: `67d4cf1` (PR #109 merge).
Scope: compare the Skelet-owned reference board (ordered collections with
dense ranks, REST/MCP/UI parity, and handoff ledger, qualified in
AF-07/08/09) against the ArtCraft moodboard transplant candidate
(inventoried in AC-00-i: 70 files at pinned artcraft commit `28a39a0`,
8 externals). No code transplanted by this grain. Every static fact
cited below is asserted offline by `tests/test_ac02_board_decision.py`;
CI never touches the network.

## 1. What was measured (all values extracted, none hand-typed)

| Dimension | Skelet-owned board | Donor moodboard (70 files) |
|---|---|---|
| Persistence | PostgreSQL canonical: dense zero-based ranks (migration 014), handoff ledger table (migration 015) | 5 persistence files; sync core flagged network (2 files) + storage (5 files, incl. `moodboardSync.ts`) — must be replaced, not reused |
| External dependencies | 0 new (`konva`, `react-konva`, `zustand` all absent from web package) | 8 (`konva`, `react-konva`, `zustand`, `uuid`, `lucide-react`, `react-colorful`, `react-hot-toast`, `vitest` dev) |
| Surfaces | 8 REST routes + 1 page + 3 MCP tools (`board_handoff`, `board_list_handoffs`, `board_validate_items`) | 38-file Konva canvas + 15-file grid + presentation view + history store + selection (3) + snapping (2) |
| Virtualized grid | none proven (no virtualization coverage in tests) | 16 grid files incl. `BoardGridView` — the sole donor lead |
| Keyboard | native keyboard-operable controls, tested | `useMoodboardKeybinds` present — parity, not a differentiator |
| SSR posture | server-rendered Next.js route + capability-gated export | client-only canvas surface (38 canvas files on `react-konva`) |
| Cross-agent handoff | ledger + validation + pack recovery by URI | no handoff path in inventory |
| Rights/provenance | partial-warning exports; withheld items never leak (proven) | no rights/provenance path in inventory |
| Mobile/responsive | unmeasured (no assertions either side) | unmeasured — not a decision factor |

## 2. Verdict: KEEP Skelet-owned, adopt nothing

1. **The transplant keeps the shell and discards the engine.** The donor's
   multi-device value lives in the 5 flagged sync files, which must be
   replaced by Skelet collection persistence anyway. What remains is UI
   shell with foreign state.
2. **An entire foreign state-management stack for unneeded richness.**
   Adopting Konva + zustand (+ 6 more externals) to serve ordered evidence
   collections — which the qualified board already serves through
   REST/MCP/UI with move semantics — inverts the adapter posture the
   program requires.
3. **Handoff and rights have no donor counterpart.** The ledger, the 3
   MCP tools, and the fail-closed pack export are the agent-parity core;
   the inventory shows nothing to adopt there.
4. **The one genuine donor lead does not justify the bundle.**
   Virtualized grids exceed what journey (b) exercises on qualified
   sizes, and no perf baseline exists to prove Skelet's list inadequate
   (AC-00 perf leg still open). A grid is a future focused grain, not a
   transplant reason.
5. **Keyboard is parity; mobile is unmeasured both sides.** Neither moves
   the decision.

## 3. Revisit triggers (not deferrals of required work)

- If a perf baseline proves Skelet's board list inadequate for large
  boards, re-evaluate a narrow grid-only transplant behind the Skelet
  adapter (no sync/store transplant, rights-filtered, a11y/SSR-gated).
- If freeform canvas or presentations are ever required by user
  journeys, re-evaluate scoped primitives (PageDraw conditional stands).
- No action until either condition is measured.
