# P11 Scope Disposition — Lexical Baseline Qualified, Embeddings Opt-In Future (Plan-Grounded)

Status: DISPOSITION RECORD with machine-checked traceability. Base: `bd9039e` (PR #115 merge).
Scope: separate what P11 means now (qualified) from what stays an
opt-in future (deferred with triggers), grounded in plan section 24.2
and the AF-00 blueprint. No code, config, or dependency changed by
this grain. Traceability is asserted offline by
`tests/test_p11_scope.py`; CI never touches the network.

## Qualified now (AF-04 + AF-13a + AF-14b + benchmarks + R3 journey proof)

- Deterministic lexical baseline: PostgreSQL FTS plus token-set
  Jaccard over title, summary, canonical text, and tags, with
  4-decimal rounding and score-desc/title/id-asc ordering.
- All 11 canonical artifact kinds participate in `find_similar` with
  identical authorization, ordering, and truncation semantics.
- Rights filtering before ranking on every path; actor-scoped results;
  explicit limits with stable ordering and opaque cursors.
- MCP/REST deep-equal parity for search, similar, and compare;
  frozen synthetic relevance fixtures with measured baselines.
- Labeled `deterministic-computation` everywhere; nothing is advertised
  as a semantic embedding.

## Deferred opt-in future (plan section 24.2 + blueprint)

| Item | Plan basis | Trigger to re-evaluate |
|---|---|---|
| pgvector-backed semantic text embeddings | "future opt-in enhancement", not a prerequisite; no mandatory pgvector population or GPU | Measured lexical inadequacy on a judged corpus, plus pinned model/rights/perf acceptance, CPU budget, opt-in install, and deterministic fallback |
| Visual/perceptual embeddings | same as above; image-semantic similarity is an OPTIONAL customer-run plugin, never falsely advertised | Same trigger class, local-only, with license and weight pins |
| Hybrid ranker beyond lexical+Jaccard | baseline is the dependable contract until beaten | Benchmark-justified quality gain with latency budget intact |
| Human-judged relevance at scale | synthetic frozen set stands for the no-model core | Scale expectations requiring judged evaluation |

## Why this split is the evidence-backed disposition

1. **The plan and blueprint authorize it.** Section 24.2 and blueprint
   lines 31/122/221 make embeddings optional and forbid advertising
   lexical or perceptual aids as semantic embeddings.
2. **No vector store is mandatory.** No pgvector migration exists in the
   repo; the lexical path has no vector dependency to remove.
3. **The baseline is measured, not assumed.** Lexical p95 figures and
   similarity ordering are proven by committed suites; any future
   embedding must beat them under the same harness rather than replace
   them by assertion.
