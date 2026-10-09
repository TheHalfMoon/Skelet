---
name: skelet-lens
description: Turn a design reference into implementation context with Skelet evidence. Use when bootstrapping a build from a reference pack; automated URL analysis lands in a later phase.
---

# Skelet Lens

Turn references into implementation context grounded in Skelet evidence.

## Current capabilities

URL capture (`analyze_url`) and image analysis (`analyze_image`) land with the Lens pipeline in a later phase. Until then, this skill covers the evidence-to-build path that works today:

1. **Research the reference space.** Use `search_assets` and `get_registry_item` to gather the closest qualified building blocks (components, icons, type direction) before writing code.
2. **Package the context.** Bundle findings with `create_reference_pack`: component-to-task mapping, known gaps marked explicitly as stubs, and every entry URI-grounded.
3. **Build from the pack, not from memory.** Unknown interactive behavior stays a `TODO`, never a claimed functional clone. Generated code must be distinguishable from any observed source material.

## When Lens URL analysis lands

- Submit bounded, authorized `http(s)` captures and poll the analysis job; never present partial results as complete coverage.
- Per-page evidence gaps, rights classifications, and observed-vs-generated labels travel with every export.
- This skill will reference `analyze_url` once its contract is qualified; until then, do not invoke or promise it.

## Rules

- Never claim access to a site's proprietary source. Source-grounded means cited, not copied.
- Restricted, trademarked, or unknown-license bytes never enter downloadable artifacts.
- Every build context cites recoverable Skelet URIs a second agent can use.
