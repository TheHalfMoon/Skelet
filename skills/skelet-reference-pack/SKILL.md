---
name: skelet-reference-pack
description: Persist and reuse Skelet evidence across agents and sessions. Use when handing off research or resuming saved work.
---

# Skelet Reference Packs

Persist evidence so any later agent recovers it without the original session.

## Workflow

1. **Create the pack.** `create_reference_pack` with `workspaceId`, `title`, and the `artifactIds` that matter. The result carries a versioned schema (`skelet/reference-pack/1`) and a stable `skelet://collection/{id}` URI.
2. **Grow it incrementally.** `save_reference` adds canonical artifacts; re-saving is idempotent.
3. **Hand off the URI, not prose.** The next agent calls `get_object` with the pack URI and recovers every entry: URIs, kinds, titles, and rights. Verify recovery by listing `items` and spot-checking one entry with `get_object`.
4. **Respect scope.** Packs inherit their collection's workspace and visibility. An outsider's read fails closed; never route around it by copying bytes out of band.

## Rules

- Pack exports are evidence indexes, not file bundles: restricted bytes are never embedded.
- Item cap and title bounds are enforced server-side; split oversized packs instead of working around them.
- Reference the pack schema version in handoffs so future formats stay distinguishable.
- REST parity: packs are collections; `GET /api/v1/objects?uri=` recovers them over HTTPS.
