---
name: skelet-assets
description: Select icons, logos, fonts, and components from Skelet with rights metadata. Use when choosing visual assets for an interface.
---

# Skelet Assets

Select visual assets with explicit rights metadata. A result without provenance and a serving policy is incomplete — never hand a developer a file path without its license story.

## Workflow

1. **Search once across kinds.** `search_assets` covers `icon`, `logo`, and `font` in one call. Filter with `kinds`, and narrow server-side where the registry supports it.
2. **Resolve with policy.** `get_asset` returns `serving: download` only for permitted rights plus a redistributable license with no trademark claim. Anything else is `metadata-only` with a `servingReason` — surface that reason to the human instead of the bytes.
3. **Components come from the registry.** `get_registry_item` fetches `skelet-button` and `skelet-card` documents (shadcn-compatible). Installed files resolve `@/lib/utils` per shadcn convention; the consumer configures the alias.
4. **Record the decision.** Save chosen assets with `save_reference` so the implementation agent recovers the exact record, license, and rights classification.

## Rules

- Trademarked logos are never downloadable, even under permissive code licenses. Record the guideline URL separately.
- Font metadata is indexed without implying redistribution rights; only `download`-policy records carry retrievable bytes.
- Unknown licenses fail closed to `metadata-only`. Do not reinterpret them.
- Cite every asset as `skelet://artifact/{id}` with its license and serving decision.
