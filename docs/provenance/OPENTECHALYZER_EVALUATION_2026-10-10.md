# OpenTechAlyzer Adapter Evaluation (G09-06)

Date: 2026-10-10.
Upstream: https://github.com/Houseofmvps/opentechalyzer.
Pinned commit: `a3d30e479c91c06732ef88867d69b7feef8f3f35` (verified HEAD via
`git ls-remote` at evaluation time; shallow clone confirms the same SHA).
Version at pin: 0.4.2. License: MIT (verified via GitHub API, package.json,
and the LICENSE file at the pinned commit). No source code was imported in
this grain.

## What was inspected

- `package.json`: runtime dependencies `@modelcontextprotocol/sdk@^1.13.0`,
  `kleur`, `zod@^3.24.1`; optional peer `playwright@^1.40.0` (full browser,
  not core); Node engines `>=18.17`; vitest suite.
- `src/detect/engine.ts`: pure regex-pattern matcher over caller-supplied
  haystacks with per-pattern confidence, source reliability weighting
  (`SOURCE_RELIABILITY`), evidence truncation, and fail-soft handling of
  malformed patterns. No network dependency observed in the engine.
- `src/fingerprints/`: built-in database (`DATABASE_VERSION 0.2.0`),
  described as authored for the project and MIT licensed, covering
  platforms, frameworks, libraries, analytics, commerce, infrastructure,
  and services. `loadExternalDatabase` (external.ts) can merge a community
  dataset at runtime.
- `src/collect/`: live collectors — HTTP fetch fan-out, DNS, TLS/certs and
  certificate transparency, sourcemaps, favicon hashing, crawling, and
  browser rendering via the peer Playwright dependency.
- `src/enrich/`: external enrichment — CVE, Tranco, BigQuery reverse,
  subdomain enumeration, email verification, TLS/watch signals.

## Compatibility verdict

The detection engine shape and the built-in fingerprint database are
compatible in principle with Skelet's offline model; the collectors and
enrichment are **rejected**:

1. Live collectors perform active probing (HTTP fan-out, DNS/TLS/CT,
   crawling, rendering) outside Skelet's SSRF-guarded DNS-pinned ingress.
   Intrusive scanning of third-party sites is out of scope for Lens.
2. External enrichment (BigQuery, Tranco, CVE feeds, email verification)
   violates the no-mandatory-external-service rule.
3. Runtime community-database merging (`loadExternalDatabase`) would inject
   unpinned third-party data and must stay disabled in any future use.
   Verified 2026-10-10 in `src/fingerprints/external.ts`: the default
   external source is `enthec/webappanalyzer`, licensed GPL-3.0 and fetched
   at runtime from raw.githubusercontent.com. Vendoring or bundling that
   dataset would impose GPL-3.0 obligations on the distributed work, which is
   incompatible with Skelet's licensing posture. This independently confirms
   that only the MIT-licensed built-in database may ever serve as design
   reference, and runtime merging stays disabled.
4. The optional full-`playwright` peer dependency must never enter Skelet;
   headless-shell via pinned `playwright-core` remains the only browser path.

## Reuse shortlist (reference only, no import)

1. `src/fingerprints/` built-in database as design reference for a
   Skelet-owned bounded fingerprint set, restricted to signals observable
   from already-guarded capture evidence (response headers, HTML body,
   offline DOM). External-database merging stays disabled.
2. `src/detect/engine.ts` evidence-graded matching shape (per-pattern
   confidence, source reliability, truncated evidence, fail-soft regex) as
   design reference for a Skelet-owned tech-clue matcher emitting
   explicitly low-confidence clues with evidence links — no certainty
   laundering.

## Rights flags for any future tech-clue grain

- Clues must carry confidence/source and link to the exact capture evidence;
  never present heuristic matches as confirmed stack facts.
- No intrusive scans, no enrichment egress, no unpinned fingerprint data.

## Decision

EVALUATED, NOT IMPORTED. The adapter decision stays EVALUATE with narrowed
scope: fingerprint/evidence-graded matching reference only, running solely
on guarded capture evidence. Live probing and enrichment are explicitly out
of scope for Skelet Lens.
