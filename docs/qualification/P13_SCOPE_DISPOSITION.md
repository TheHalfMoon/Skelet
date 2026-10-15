# P13 Scope Disposition — Read API Qualified, Watch/Scoring Post-Launch (Plan-Grounded)

Status: DISPOSITION RECORD with machine-checked traceability. Base: `3e70aed` (PR #114 merge).
Scope: separate what P13 means now (qualified) from what stays
post-launch (deferred with triggers), grounded in plan sections 14
(P13), 15 (launch cut), and 19 (stop/defer rules). No code, config, or
dependency changed by this grain. Traceability is asserted offline by
`tests/test_p13_scope.py`; CI never touches the network.

## Qualified now (AF-15a + R3 journey proof)

- Deterministic two-version diff over persisted evidence: added,
  removed, changed, and reordered artifacts and flows with
  ledger-backed identity, rights-gated visibility, stable change IDs,
  deterministic ordering, and cursor pagination.
- One canonical contract on both transports: `get_changes` MCP tool
  plus `GET /api/v1/changes` with deep-equal envelopes.
- No model prose, no intent inference, no scheduling, no scoring.

## Deferred post-launch (plan section 15 names them explicitly)

| Item | Plan basis | Trigger to re-evaluate |
|---|---|---|
| Scheduled/explicit recapture policy + watch/subscribe API | post-launch scope: "broad continuous watch/Time Machine schedules"; launch MUST NOT be blocked by P13 | User journeys requiring continuous monitoring, with quota/cost attribution for scheduled capture |
| Persistent change-event log | same as above (no event store in the qualified read path) | Watch API scoping designs the log with retention/purge from day one |
| Meaningful-change scoring | P13 exit criteria allow scoring only as deterministic signals plus optional enrichment; mandate forbids intent inference | Scoring thresholds validated against labeled data; cosmetic-vs-structural signals proven deterministic first |

## Why this split is the evidence-backed disposition

1. **The plan authorizes it.** Section 15 puts continuous watch
   schedules in post-launch scope and forbids blocking launch on P13.
2. **The qualified path covers the launch-critical need.**
   Evidence-linked diffs between versions/captures/snapshots work now
   through MCP, REST, and the R3 journey; nothing launch-critical waits
   on schedules or scores.
3. **Scoring without labeled data would be fabrication.**
   Deferring scoring until thresholds are validated beats shipping
   heuristic numbers that agents would cite as facts.
