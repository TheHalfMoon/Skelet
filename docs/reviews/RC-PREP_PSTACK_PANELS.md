# Release-Candidate Prep PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback on the exact staged diff (builder MJS + node test MJS + procedure MD + doc test PY). MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.47, correctness 0.49, evidence 0.26, reliability 0.35, scope 0.22, security 0.25 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`). Scores dispositioned below (new-script claim surface, not a changed contract).
- Suites: release-candidate node 2/2; doc 6/6; graft `build` + `check` green.

## Correctness — PASS

- Builder emits git-archive tarball + manifest + SHA256SUMS with fail-closed exclusions, 256 MB budget, SBOM requirement, and 0/2/3 exit contract; the test recomputes the digest and asserts both refusal paths; the measured probe (962 files, 1,134,573 bytes, exit 0) matches the doc; version is proposal-only with no tag; OD-05 records the license gap without granting terms. Zero must-fix.

## Parsimony — PASS

- One script, one node test, one procedure doc, one doc test, four review records. No route, schema, API, MCP, migration, dependency, UI, billing, or config change. Zero must-fix.

## Product — PASS

- Gives v1 Local a real, executable RC builder (not a packaging memo) with per-commit digests for the OD-02 ceremony and an honest unsigned state; final release stays blocked on OD-02/OD-03/OD-05. Zero must-fix.

## Security — PASS

- Forbidden-path scan precedes archiving; no secrets in tarball/manifest/test; unsafe versions rejected; candidate explicitly unsigned; spawn paths shell-free. Zero must-fix.
