---
name: skelet-research
description: Research real shipped design references in Skelet before proposing UI. Use when starting interface work, comparing patterns, or grounding design decisions in evidence.
---

# Skelet Research

Research real shipped references before proposing UI. Every claim must cite recoverable Skelet evidence — an agent output without stable Skelet IDs or URIs is incomplete.

## Workflow

1. **Search the corpus first.** Call `search_assets` with the design vocabulary at hand (`query`, optional `kinds`, `limit`). One query searches icons, logos, and fonts on a shared contract.
2. **Inspect before citing.** Call `get_asset` with the `artifactId` behind each `skelet://artifact/{id}` URI. Read `rights`, `license`, `serving`, and `servingReason` — never promise bytes the policy withholds.
3. **Recover across sessions.** Persist what matters with `save_reference` into a workspace collection, or bundle it with `create_reference_pack`. Hand the next agent pack URIs (`skelet://collection/{id}`), never prose copied from chat.
4. **Compare with evidence.** When comparing options, cite each candidate's URI plus its rights classification. Distinguish observed facts (fields on the record) from your own inference.

## Rules

- Anything you inspected must be recoverable via `get_object` with its URI.
- `metadata-only` records are citable for research but never downloadable.
- Trademarked marks require brand-owner permission regardless of license text.
- REST parity: `GET /api/v1/assets`, `GET /api/v1/assets/{id}`, `GET /api/v1/objects?uri=` serve the same contracts over HTTPS with a session bearer token.
