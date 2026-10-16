# P10 Live Capture Disposition — Representation Qualified, Recorder Deferred with Triggers (Plan-Grounded)

Status: DISPOSITION RECORD with machine-checked traceability. Base: `368700c` (PR #132 merge).
Scope: separate what P10 means now (qualified) from what stays
deferred (the live browser capture client), grounded in plan section 14
(P10) and the provider list. No code, config, or dependency changed by
this grain. Traceability is asserted offline by
`tests/test_p10_capture.py`; CI never touches the network.

## Qualified now (AF-06/14a/14d + replay ledger/transport/playback + R3 journey proof)

- Authorized corpus importer with ledger-idempotent flow ingestion.
- Product/version gallery reads feeding flows and changes.
- Flow player with inspection/playback over qualified reads.
- Pattern taxonomy reads and UI.
- Consented replay-event ledger storing rrweb-compatible envelopes
  (numeric type, millisecond timestamp, data object) with pre-storage
  redaction, ordering, close lifecycle, and byte/event budgets.
- Four replay session verbs on MCP + REST with deep-equal parity.
- Flow-player replay stepping over the qualified read path.
- Every replayed object has a stable `skelet://` URI with a structured
  representation (agent parity without a capture client).

## Deferred: live browser capture client (recorder with consent UX)

| Ground | Source |
|---|---|
| No `rrweb` in the dependency tree | `apps/web/package.json` has no rrweb entry |
| No client `record()` call in web surfaces | no `record(` invocation in `apps/web/app` or `apps/web/lib` |
| Representation without capture is the plan shape | P10 deliverable is "rrweb representation for newly captured web flows"; the ledger stores that representation today |
| Recording is privacy-sensitive UI | consent copy, placement, and default-off posture need explicit owner approval before shipping |
| Untrusted page content inside a recorder needs sandbox/CSP/bundle review | that evaluation belongs to the adoption grain, not this one |

Feasibility is established, not blocked: `rrweb` 2.1.7 is MIT-licensed
and available, the ledger envelope already mirrors its event contract,
the session verbs already enforce redaction/budgets/ordering, and the
flow player already steps recorded events. Nothing in this record claims
that replaying agent-recorded ledger events proves genuine browser
capture — it does not.

## Why deferral is the evidence-backed disposition

1. **The plan asks for representation first.** The P10 exit criteria
   require imported screens/flows to coexist in one graph with replay
   evidence references — all of which work now through the importer,
   gallery, flow player, and ledger.
2. **Recording without approved consent UX would be a privacy defect.**
   A recorder that starts without explicit opt-in, or that ships
   consent copy the owner has not approved, is worse than no recorder.
3. **Adoption without a journey need is dead code.** An rrweb dependency
   with no supporting consent UX, redaction proof, and Chromium
   round-trip test adds bundle weight for zero journeys.

## Trigger to re-evaluate

Owner-approved consent UX (explicit opt-in, never default-on, approved
copy and placement) plus pinned `rrweb` (license, version, bundle cost)
plus pre-storage redaction proof plus a real-Chromium record-to-ledger-
to-playback round-trip test plus a measured journey need that
agent-side session recording cannot serve; the existing ledger,
transport, and stepping surfaces stay the fallback and the contract.
