---
name: skilit-lens
description: Turn a design reference into implementation context with Skilit evidence. Use when bootstrapping a build from a reference pack; automated URL analysis lands in a later phase.
---

# Skilit Lens

Turn references into implementation context grounded in Skilit evidence.

## Current capabilities

URL capture (`analyze_url`) and image analysis (`analyze_image`) land with the Lens pipeline in a later phase. Until then, this skill covers the evidence-to-build path that works today:

1. **Research the reference space.** Use `search_assets` and `get_registry_item` to gather the closest qualified building blocks (components, icons, type direction) before writing code.
2. **Package the context.** Bundle findings with `create_reference_pack`: component-to-task mapping, known gaps marked explicitly as stubs, and every entry URI-grounded.
3. **Build from the pack, not from memory.** Unknown interactive behavior stays a `TODO`, never a claimed functional clone. Generated code must be distinguishable from any observed source material.

## When Lens URL analysis lands

- Submit bounded, authorized `http(s)` captures and poll the analysis job; never present partial results as complete coverage.
- Per-page evidence gaps, rights classifications, and observed-vs-generated labels travel with every export.
- Single-shot URL analysis (`analyze_url`) and image analysis (`analyze_image`) land with the Lens pipeline in a later phase; until then, do not invoke or promise them — drive the qualified job tools below instead.

## Lens build-kit jobs (qualified)

The durable URL-to-kit lifecycle is qualified on REST, MCP, and the operator UI. Address every job by its stable `skilit://lens/{id}` identifier and pass the owning `workspaceId` on each call:

1. **Create.** Use `lens_create_job` with the source URL, capture mode, budgets, and an idempotency key; replays converge on one job.
2. **Poll and inspect.** Use `lens_poll_job` for status and `lens_get_job` for evidence, artifact summary, and attempt history; watch until a terminal state instead of assuming completion.
3. **Recover.** Use `lens_retry_job` within budget after failure, `lens_resume_job` with a worker label after interruption, and `lens_cancel_job` for active runs; repeat cancellation is explicit.
4. **Download.** Use `lens_read_artifact` for the manifest or evidence document; withheld files are listed, never served.

## Rules

- Never claim access to a site's proprietary source. Source-grounded means cited, not copied.
- Restricted, trademarked, or unknown-license bytes never enter downloadable artifacts.
- Every build context cites recoverable Skilit URIs a second agent can use.
