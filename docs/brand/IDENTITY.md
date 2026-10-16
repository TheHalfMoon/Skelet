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
| `apps/web/public/brand/skilit-social-light.svg` | Editable 1200×630 social/repository composition on cream |
| `apps/web/public/brand/skilit-social-orange.svg` | Editable reverse composition on muted orange |
| `apps/web/public/brand/skilit-social-light.png` | Open Graph and default web card (1200×630) |
| `apps/web/public/brand/skilit-social-orange.png` | Alternate social and GitHub preview (1200×630) |

The entire identity can be regenerated with
`python3 scripts/generate_skilit_brand.py`. The S uses one continuous,
unbroken silhouette with no shadows, outlines, glow, highlights, or gradients.
Do not stretch or rotate the symbol. Leave generous clear space around it.


The active sidebar and authentication pages use **Skilit** exactly (capital S,
no trailing period); the identity is not rebranded to any integration source
name. The two social compositions use the *same* generated S path and the same
ink and orange palette as the existing lockups. No alteration to the approved
S silhouette is permitted without founder approval.

## Regeneration and publishing boundaries

From a frozen, fully installed checkout with pinned Chromium headless shell:

```sh
python3 scripts/generate_skilit_brand.py
node scripts/render_skilit_social.mjs
node --experimental-strip-types --test apps/web/tests/brand-identity.test.mjs apps/web/tests/brand-social.test.mjs
```

The renderer reuses `playwright-core` already pinned by the Lens package and
makes **no network requests**. Generated PNGs are checked into Git so normal
runtime/build and link-preview requests don't require Chromium.

Next.js uses `skilit-social-light.png` for Open Graph and Twitter cards. The
metadata origin defaults to `http://localhost:3000` for local development;
a deliberately internet-facing installation must explicitly set
`SKILIT_METADATA_ORIGIN=https://its-actual-hostname.example` **at build time**
before publishing a link, otherwise third-party preview crawlers cannot
retrieve images from localhost. The example hostname is explanatory only and
not a Skilit deployment target.

GitHub's repository social preview is a **repository Settings** control, not
something README or metadata can update automatically. An authorized operator
can manually upload `skilit-social-light.png` or
`skilit-social-orange.png` in Settings → General → Social preview. These
assets being committed do *not* imply that the GitHub preview has been set.

No release tags, signed artifacts, deployment, or public announcement are
affected by regenerating or updating the branding source.

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
