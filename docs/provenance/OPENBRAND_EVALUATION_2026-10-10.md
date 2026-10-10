# OpenBrand Adapter Evaluation (G09-05)

Date: 2026-10-10.
Upstream: https://github.com/tight-studio/OpenBrand.
Pinned commit: `a21d34fadc3dcf15271d71fdb3f7d95baf7578d8` (verified HEAD via
`git ls-remote` at evaluation time; shallow clone confirms the same SHA).
Version at pin: 0.2.3. License: MIT (verified via GitHub API, package.json,
and the LICENSE file at the pinned commit). No source code was imported in
this grain.

## What was inspected

- `package.json`: runtime dependencies `@supabase/ssr`, `@supabase/supabase-js`,
  `cheerio@^1.2.0`, `probe-image-size`, `sharp@^0.34.5`; Next.js 16 + React 19
  dev stack; `bun test` integration suite. No Playwright dependency.
- `src/scraper.ts` (651 lines): `extractBrandAssets(url)` fetches the target
  with global `fetch` (`redirect: "follow"`, 15s timeout, browser User-Agent),
  falls back to the third-party reader `https://r.jina.ai/${url}` when the
  direct fetch fails or returns too little content, then parses HTML with
  cheerio (`parseHtml`, private non-exported function) into logos, colors,
  and backdrop images with `probe-image-size`/`sharp` enrichment.
- `src/types.ts`: output contracts `LogoAsset` (url, alt, type, resolution),
  `ColorAsset` (hex, usage), `BackdropAsset` (url, description),
  `BrandExtractionResult`, and typed `ExtractionError` codes.
- `lib/url.ts`: URL normalization only (lowercase host, trailing-slash and
  hash handling). No SSRF guard, no DNS validation, no private-range
  rejection.

## Compatibility verdict

OpenBrand's live fetch path is **rejected** for Skelet integration:

1. Global `fetch` with `redirect: "follow"` performs no DNS pinning, no
   per-hop redirect revalidation, and no private/metadata-range rejection,
   violating Skelet's fail-closed SSRF posture (G09-01/G09-03).
2. The Jina reader fallback sends the target URL to an external third-party
   service, violating the no-mandatory-external-service rule and leaking
   browse intent off-site.
3. Runtime weight (`@supabase/*`, `sharp` native, Next.js app shell) is
   disproportionate for Skelet's offline capture pipeline.

## Reuse shortlist (reference only, no import)

1. `src/types.ts` output shapes as design reference for Skelet's own
   brand-clue adapter contract (logo/color/backdrop fields and error codes).
2. Selector heuristics inside the private `parseHtml` as design reference for
   a future Skelet-owned offline parser operating exclusively on
   SSRF-guarded HTML. Because `parseHtml` is not exported, any reuse means a
   clean-room port behind Skelet's provider contract, not an import.

## Rights flags for any future brand-clue grain

- Extracted logo/brand bytes are trademark-restricted and must never enter
  downloadable artifacts; only references with provenance and serving policy
  may be stored (consistent with the Assets v1 plan).
- `probe-image-size`/`sharp` enrichment must not fetch remote bytes; any
  dimension probing runs against already-guarded captures or not at all.

## Decision

EVALUATED, NOT IMPORTED. The adapter decision stays EVALUATE with narrowed
scope: type-shape and heuristic reference only. Live fetching and byte
serving are explicitly out of scope for Skelet Lens.
