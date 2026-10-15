# AF-14b-i PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.58, correctness 0.28, evidence 0.31, reliability 0.42, scope 0.22, security 0.5 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: assets 26/26 (25 prior + 1 new), web/node/worker 122/122 (121 prior + 1 new), python 182/182, all validators PASS, lint/typecheck clean on assets plus web, Graft `build` + `check` green locally.

## Correctness — PASS

- Screens, pages, and all remaining canonical kinds use the identical lexical baseline (token-set Jaccard, 4-decimal rounding, score-desc/title/id-asc order, 500-cap truncation) with hand-verified screen ranking, kinds filtering, invalid-kind rejection, and MCP/REST deep-equal parity. Zero must-fix.

## Parsimony — PASS

- One kinds-gate widening, one schema enum extension, one stale union widened, two tests. No new tools, no migration, no skill change, no search_assets ranking change, no embeddings. Zero must-fix.

## Product — PASS

- Closes the P11 artifact-to-similar gap for research corpus artifacts (screens/pages/sections/components and the rest) on the explicit non-semantic baseline; hybrid ranking, visual similarity, and optional embedding plugins remain follow-ons with their own acceptance. P11 row advances but stays non-VERIFIED until those land. Zero must-fix.

## Security — PASS

- Reference and candidate gating unchanged (getArtifactForActor before scoring, workspace-membership predicate before rank, no oracle, restricted reference still RIGHTS_RESTRICTED, private screens denied on both transports and tested). Zero must-fix.
