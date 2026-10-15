# P12 MCP Apps Views Disposition — Deferred as Progressive Enhancement (Plan-Grounded)

Status: DISPOSITION RECORD with machine-checked traceability. Base: `d3780f3` (PR #118 merge).
Scope: separate the qualified P12 core (boards, handoff, packs,
compaction, gallery reads, agent parity) from MCP Apps `ui://` views,
which stay deferred as progressive enhancement per the plan and
blueprint. No code, config, or dependency changed by this grain.
Traceability is asserted offline by `tests/test_p12_apps.py`; CI never
touches the network.

## Qualified now (AF-07/08/09/14c/14d + R3 journey proof)

- Ordered board domain with REST/MCP/UI parity and handoff ledger.
- Reference packs with versioned `skelet/reference-pack/1` compaction,
  partial-warning semantics, and cross-agent recovery by URI.
- Product/version gallery reads feeding flows and changes.
- Three wire clients plus REST fallback pass the main journeys;
  unsupported extensions degrade without breaking results.
- Every human-facing object has a stable `skelet://` URI with a
  structured representation (agent parity without Apps).

## Deferred: MCP Apps `ui://` views (gallery, flow player, compare, picker, Lens report, board)

| Ground | Source |
|---|---|
| No Apps SDK in the dependency tree | `apps/web/package.json` has no MCP SDK |
| `resources/list`, `prompts/list`, `tasks/get` answer `-32601` with REST fallback | existing interop test, re-asserted here |
| Never assume Apps in every client | plan section 23.3 |
| Progressive enhancement, not required for core evidence; embed only via official UI resources with sandbox | blueprint transport section |

## Why deferral is the evidence-backed disposition

1. **The plan and blueprint authorize it.** Apps are explicitly
   progressive enhancement; core evidence must stay reachable without
   them — and it is (every view has a URI + MCP/REST equivalent).
2. **Adoption without hosts is dead code.** An Apps SDK with no
   supporting host adds dependency weight for zero journeys.
3. **Sandbox discipline is non-negotiable.** Untrusted design content
   inside embedded UI requires official UI resources with sandboxing;
   that evaluation belongs to the adoption grain, not this one.

## Trigger to re-evaluate

Official Apps SDK evaluated (pin, license, bundle cost) plus at least
one supporting host plus a measured journey need that URI + MCP/REST
cannot serve; embed only via official UI resources with sandbox, with
the existing surfaces kept as the fallback.
