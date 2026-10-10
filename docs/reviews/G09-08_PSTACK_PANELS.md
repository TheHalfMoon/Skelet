# G09-08 PStack Fresh-Context Review and Fix Cycles

Review source: PStack ps-review protocol, pinned local skill checked out under /tmp/skelet-pstack-review. Fresh independent Codex sessions, read-only. Specialized agent providers unavailable: the judges used PStack inline bars, not four independent provider models.

## Initial fresh-context PStack panel

Review basis: canonical `79d5ad38…` through the working tree, including both intent-to-add Lens files. No local PStack `ps-review` skill was present. No files were edited.

## Must-fix

- **Malformed JPEGs and decode-memory bombs pass validation.** [report-assembly.ts:177](packages/lens/src/report-assembly.ts:177) checks only base64 canonicality, byte size, and SOI/EOI markers. The four-byte “JPEG” used at [report-assembly.test.mjs:6](packages/lens/tests/report-assembly.test.mjs:6) has no frame or scan and is not a decodable screenshot. A small JPEG can also declare enormous dimensions, so the 2 MB compressed-byte cap does not bound downstream decode memory. Validate JPEG structure and enforce width, height, and total-pixel limits.

- **`analysisId` is not bound to the complete returned report.** The hash at [report-assembly.ts:207](packages/lens/src/report-assembly.ts:207) omits `htmlBytes` and `redirects`; I confirmed reports with different values receive the same ID. It also lacks a projection/schema domain separator, allowing future constant-field changes without an ID change. Hash a canonical report payload excluding only `analysisId`, or explicitly define and rename the narrower identity. Expand the misleading test at [report-assembly.test.mjs:134](packages/lens/tests/report-assembly.test.mjs:134).

- **Valid negative spacing disappears from DTCG without an honest exclusion.** [report-assembly.ts:93](packages/lens/src/report-assembly.ts:93) rejects `-8px`, although the extractor intentionally accepts negative margins at [design-tokens.ts:1208](packages/lens/src/design-tokens.ts:1208). The DTCG 2025.10 dimension schema permits any JSON number and imposes no non-negative minimum ([official format specification](https://www.designtokens.org/tr/2025.10/format/)). The resulting token is silently absent while [report-assembly.ts:245](packages/lens/src/report-assembly.ts:245) claims absolute-pixel dimensions are exported. Export it or record the omission explicitly.

- **Capture provenance is asserted rather than established.** [report-assembly.ts:262](packages/lens/src/report-assembly.ts:262) always states that JavaScript and remote resources were blocked, even though the public assembler accepts any structurally valid `CaptureResult` and does not require those coverage markers. Either enforce capture-worker provenance/required gaps or describe these as upstream-reported conditions.

## Worth considering

- [report-assembly.ts:112](packages/lens/src/report-assembly.ts:112) uses `Array.prototype.some`, which skips sparse-array holes. I confirmed a sparse `sections` array becomes `[null]` and a sparse coverage gap becomes `null` in serialized output. Iterate every numeric index or normalize before validation.

- Add an aggregate declaration-character/body budget. The existing limits at [design-tokens.ts:140](packages/lens/src/design-tokens.ts:140) permit roughly 66.5 million UTF-16 code units before object and normalization overhead.

- The hostile-content test at [report-assembly.test.mjs:82](packages/lens/tests/report-assembly.test.mjs:82) proves only that unsafe strings remain data and are absent from DTCG. It does not prove safe embedding in HTML `<script>` contexts or CSS sinks. Add downstream sink tests and require `application/json` plus context-appropriate escaping.

- Validate a complete emitted DTCG fixture against a pinned offline 2025.10 schema. The current color shape is valid—sRGB components, optional alpha in `[0,1]`, and six-digit fallback hex match the [official color specification](https://www.designtokens.org/tr/2025.10/color/)—but current tests only spot-check fields.

## Skip / no finding

- No network access, credential use, or execution occurs in this projection.
- Asset links remain non-downloadable with unknown rights; syntactic-only URL validation is appropriate while they remain identifiers.
- Explicit ordering avoids locale/host-dependent sorting. The determinism defect is hash coverage, not host variance.
- `status: "partial"`, empty unsupported-provider fields, coverage gaps, and unsafe DTCG exclusions are generally honest for this bounded grain; missing full §8 providers are not a defect here.

## Four-bar verdicts

- **Correctness: FAIL** — JPEG validation, incomplete identity, negative-spacing omission.
- **Parsimony: PASS** — focused, dependency-free projection with proportionate structure.
- **Product: FAIL** — broken screenshots can be published and provenance/omission claims can mislead consumers.
- **Security: FAIL** — unbounded decoded-image dimensions and incomplete runtime trust-boundary validation.

Verification: all 8 report tests passed, as did Lens typecheck, lint, and `git diff --check`; the findings are coverage/contract defects not caught by the suite.

## First delta (original must-fix closures)

## Must-fix findings

- [jpeg-evidence.ts:61](packages/lens/src/jpeg-evidence.ts:61) only recognizes SOF0–SOF2 but silently treats other SOF markers as generic segments. A JPEG containing a huge SOF3 followed by the fixture’s SOF0 is accepted as 20×20; `djpeg` rejects it as “two SOF markers.” Thus malformed framing remains accepted despite the claim at [G09-08_REVIEWS.md:14](docs/reviews/G09-08_REVIEWS.md:14). Reject every unsupported SOF-family marker.

- Current evidence documentation is inconsistent: [G09-08_REVIEWS.md:38](docs/reviews/G09-08_REVIEWS.md:38) records the old JEV probabilities, while [G09-08_JEV_REVIEW.json:1](docs/reviews/G09-08_JEV_REVIEW.json:1) now contains different results. These two unstaged JEV changes appeared during review but are currently within the requested working-tree scope.

## Original findings

- JPEG corruption/pixel bombs: **partially fixed**. Real fixture, byte bounds, and supported-frame dimension/pixel bounds are good; contradictory unsupported frames remain accepted. Full entropy decoding is not required for this grain.
- Complete domain-separated `analysisId`: **fully fixed** at [report-assembly.ts:278](packages/lens/src/report-assembly.ts:278).
- Negative-margin DTCG: **fully fixed** at [report-assembly.ts:93](packages/lens/src/report-assembly.ts:93).
- Provenance claim: **fully fixed** by required upstream markers at [report-assembly.ts:122](packages/lens/src/report-assembly.ts:122) and qualified wording at line 271.
- Sparse arrays and aggregate style budget: **fully fixed** at lines 113–123 and 177–215.

Targeted tests: 13/13 pass; fixture decodes as a 20×20 baseline JPEG; `git diff --check` passes.

## Four-bar verdict

- Security: **PASS** — bounded dimensions/bytes, and this grain has no decode/render surface.
- Correctness: **FAIL** — malformed multi-SOF JPEG acceptance and inconsistent evidence record.
- Product: **FAIL** — invalid screenshot evidence can still be published.
- Parsimony: **PASS** — focused, dependency-free changes.

## Second delta (unsupported SOF)

## Must-fix

- [jpeg-evidence.ts:65](packages/lens/src/jpeg-evidence.ts:65): unsupported SOF markers now fail closed, but the parser still treats DHP (`FFDE`, hierarchical frame dimensions) as metadata. A crafted JPEG declaring `65535×65535` via DHP before the valid `20×20` SOF is accepted as `{20,20}`; `djpeg` rejects it as unsupported. Reject DHP—and other unsupported frame-control markers—and add this case to the adversarial test.

## Four bars

- Correctness: **FAIL** — unsupported structural framing remains accepted.
- Parsimony: **PASS**
- Product: **FAIL** — invalid screenshot evidence can still be published.
- Security: **FAIL** — DHP dimensions bypass the advertised pre-decode dimension bound.

The SOF-family regression and Jev documentation synchronization are fixed. The other original must-fixes remain closed. Targeted tests: 14/14 pass; typecheck, lint, and `git diff --check` pass. No files edited.

panel: full — correctness ✓ inline · parsimony ✓ inline · product ✓ inline · security ✓ inline · deltas: mechanical tier

## Final delta (strict JPEG marker allowlist)

- Correctness: **PASS**
- Parsimony: **PASS**
- Product: **PASS**
- Security: **PASS**

Remaining must-fix: **None.**

The explicit allowlist rejects DHP `FFDE`, DNL `FFDC`, unsupported SOFs, JPEG-LS, arithmetic/reserved markers, while accepting the real 20×20 fixture. Regression suite passes **15/15**; typecheck and lint pass. Jev values match exactly between JSON and Markdown. Prior must-fixes remain closed.

**Approved for exact-head CI qualification.** Merge remains conditional on CI passing.

panel: full — correctness ✓ inline · parsimony ✓ inline · product ✓ inline · security ✓ inline · deltas: mechanical tier
