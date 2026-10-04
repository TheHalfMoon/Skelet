# Skelet Architecture Charter

Status: canonical architecture constraints for implementation

## Architectural Goal

Build Skelet as a modular monolith with stable domain and public contracts. Reuse mature permitted donors behind adapters, but keep Skelet's canonical domain, provenance model, search contract, and agent interfaces independent of any donor runtime.

## Canonical System of Record

PostgreSQL is the canonical transactional store and graph-adjacency store.

Canonical entities are defined in `docs/IMPLEMENTATION_PLAN.md` and include Source, Product, ProductVersion, Artifact, Asset, Relation, Flow, FlowStep, Pattern, Collection, CaptureRun, AnalysisRun, and ImportRecord.

Do not create independent canonical databases for icons, logos, components, screens, websites, or flows. They are typed objects in one Skelet Design Graph.

## Initial Deployable Units

1. `web`: Next.js UI, REST API, Remote MCP endpoint, MCP Apps, auth, billing, collections, search orchestration, and read APIs.
2. `worker`: capture, imports, analysis, embeddings, document processing, and scheduled refresh jobs.
3. PostgreSQL: canonical records, identity/workspace state, queue state, full-text search, and vector metadata.
4. Object storage: filesystem adapter in local development and S3-compatible storage in production.

Do not introduce additional network services unless benchmark evidence establishes a material operational need.

## Repository Shape

Target structure after the qualified upstream baseline:

```text
apps/
  web/
  worker/
packages/
  domain/
  db/
  search/
  storage/
  provenance/
  providers/
  mcp/
  registry/
  testkit/
scripts/
  imports/
  capture/
  provenance/
docs/
fixtures/
```

Use pnpm workspaces. Do not introduce Turborepo before measured build pressure justifies it.

## Provider Boundary

Every donor or external engine must sit behind a Skelet-owned adapter unless it is the selectively imported baseline itself.

Every provider contract must expose:

- capability identifier;
- exact version/source pin;
- input and output schemas;
- deterministic configuration record;
- timeout and cancellation behavior;
- provenance emission;
- error classification;
- health check;
- egress and cost classification where applicable.

Provider failures must not redefine Skelet's public schemas.

## Ingestion Boundary

All imports and captures use one normalized lifecycle:

```text
source
  -> raw record
  -> canonical normalization
  -> asset deduplication
  -> provenance validation
  -> enrichment
  -> search indexing
  -> publish
```

Publish is a final state transition. Required validation failure publishes nothing. Optional enrichment failure may produce an explicit partial-analysis state but must never corrupt canonical data.

Imports must be replayable and idempotent.

## Storage

Binary media never belongs in Git except intentionally small fixtures.

Assets are content-addressed by SHA-256 and stored through a Skelet `StorageProvider` interface. Metadata and provenance live in PostgreSQL.

## Search

Humans, REST clients, and MCP clients use one public search contract.

Initial implementation:

- PostgreSQL full-text search for names, OCR, text, tags, and metadata projections;
- pgvector for semantic and visual nearest-neighbor retrieval;
- temporary Monet/Orama behavior only behind a migration adapter.

The UI must never depend directly on a specific search engine.

## Agent Architecture

The canonical remote agent interface is MCP over Streamable HTTP plus versioned REST APIs.

Stable Skelet object URIs must survive internal database migrations and public API version changes.

Do not expose internal micro-operations as one MCP tool each. Public tools model user intent; internal adapters remain implementation details.

## Cost and Lock-In Rule

No launch-critical Skelet path may require a mandatory paid LLM, paid crawler, managed vector database, managed search engine, GPU service, or vendor-specific media CDN.

Commercial infrastructure may be adopted when measured reliability, scale, or total-cost evidence justifies it, but a provider abstraction must preserve replacement capability.

## Service-Split Rule

A package becomes an independent service only when at least one of the following is demonstrated with measurements:

- independent scaling materially lowers cost or latency;
- isolation is necessary for security or resource containment;
- failure-domain separation is required for launch SLOs;
- deployment cadence is materially blocked by the monolith;
- a provider process has incompatible runtime requirements.

Until then, keep the architecture simple.
