# Skilit brand and product interface system

This is the source-controlled identity for the Skilit development UI. The
founder-approved single-stroke **S** shape is reconstructed as editable vector
geometry, not embedded as a screenshot. Only one Skilit product identity
is used in the active UI.

## Core marks and correct usage

| Artifact | Use |
| --- | --- |
| `apps/web/public/brand/skilit-mark-orange.svg` | Orange mark on warm off-white or dark surfaces |
| `apps/web/public/brand/skilit-mark-black.svg` | Black mark on the soft orange brand field |
| `apps/web/public/brand/skilit-lockup-light.svg` | Full Skilit wordmark on cream |
| `apps/web/public/brand/skilit-lockup-orange.svg` | Full Skilit wordmark on muted orange |
| `apps/web/app/icon.svg` | Distinctive app/favicon mark (black on soft orange) |

The entire identity can be regenerated with
`python3 scripts/generate_skilit_brand.py`. The S uses one continuous,
unbroken silhouette with no shadows, outlines, glow, highlights, or gradients.
Do not stretch or rotate the symbol. Leave generous clear space around it.

## Palette (single canonical system)

| Token | Hex | Role |
| --- | --- | --- |
| Orange mark | `#F8793D` | Signature Skilit orange on cream |
| Muted orange field | `#F3A07C` | Reverse-logo background; no intense neon orange |
| Ink | `#14161A` | Reverse mark, text, high contrast |
| Cream | `#FAF9F6` | Primary mark background |
| Workspace surface | `#F7F6F3` | Main workspace background |
| Sidebar | `#191B1E` | Deep charcoal navigation |

`apps/web/app/globals.css` owns the display tokens; keep it synchronized
with `docs/brand/tokens.json`. Workflow icon tints are deliberately secondary,
not alternative brand colors. Use the orange accent sparingly.

## Typography and responsive behavior

- System sans-serif stack for reliable offline local deployment.
- Wordmark in clean, black/ink typography with carefully reduced tracking.
- Large, balanced editorial headlines and smaller legible UI labels.
- Sidebar layout on desktop; horizontal, scrollable navigation on mobile.
- Real workflow links and real service-health endpoint. No fabricated product
  usage metrics, fake authentication state, or non-functional buttons.
- Keyboard focus remains visible; reduced-motion preference is respected.

## Skilit-owned interface iconset

The app uses `apps/web/registry/skilit-ui-icons.json`, an Iconify-compatible
collection of 18 first-party geometric SVG glyphs. It follows Skilit's existing
source implementation `packages/assets/src/iconset.ts` rather than relying on
a new network dependency or third-party commercial icon library.

- Regenerate using `python3 scripts/generate_skilit_icons.py`.
- Validate the SVG bodies through the same `assertSafeSvgBody` gate used by
  the Skilit asset importer.
- React renders only predefined SVG `<path d>` data: never inject arbitrary
  or remotely supplied HTML into the DOM.
- Icon names correspond to actual Skilit product workflows.
- Keep author/source metadata in the source registry, not in customer-facing
  product icon labels.

## Boundaries

Brand/design work does **not** change authentication, persisted identities,
database schemas, REST/MCP/SDK contracts, or the signed historic pre-release.
This is development-only work: no Git tag, no public deployment, no release.

Before adopting changes, run TS, lint, Node UI contracts, production build,
Playwright desktop/mobile navigation, accessibility checks, and exact-head
GitHub CI. Functional workflow pages are preserved; new styling must not
change their behavior or unauthorized-access boundaries.
