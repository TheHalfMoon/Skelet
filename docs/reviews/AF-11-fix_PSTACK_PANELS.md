# AF-11 fix PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.49, correctness 0.46, evidence 0.24, reliability 0.40, scope 0.47, security 0.59 (model `jev-1.13.0`, ok true; CLI `jev 2026.919.0`).
- Suites: editor-adapters 50/50, lint/typecheck clean, live genuine-binary exercise green (91B png, 633B jpg, 254B flat tiff, 696B layered tiff, all magic-verified), hygiene PASS, Graft `build` + `check .` green locally; CI will re-verify at exact head.

## Correctness — PASS

- Both fixes are proven against the genuine binary and pinned by regression tests: `commands --json` (argv unit + fixture text-mode proof) and bare `--tiff-layers` for preserve / omission for flatten (argv units + preserve end-to-end + genuine rejection emulation). The header contract now matches `--help`. Zero must-fix.

## Parsimony — PASS

- Two argv branches, one header comment, genuine-emulating fixture adjustments, two regression tests, one qualification doc, one delta-log entry, review records. No new tools, routes, migrations, or UI. Refused surfaces stay refused. Zero must-fix.

## Product — PASS

- Repairs the AF-11 adapter's genuine-binary behavior and completes AC-03 raster qualification at the pinned commit. Fixture suites remain the CI story; the qualification doc is the upstream evidence. PageDraw stays deferred, OpenPencil stays P14. Zero must-fix.

## Security — PASS (with explicit argv examination for the 0.59 Jev security score)

- The higher security score reflects a grain touching subprocess argv, so the surface was re-examined literally: the only new argv atoms are the static literals `--json` and `--tiff-layers`, selected by branches over the already-validated `tiffLayers: "flatten" | "preserve"` enum and the fixed `commands` operation. No user-controlled string reaches argv except root-confined paths and validated format/quality values (unchanged from the qualified AF-11 baseline). execFile still runs with no shell, scrubbed env, confined cwd, timeout SIGKILL, and output caps. The fixture template-literal backtick breakage was fixed during authoring and lint/typecheck are clean. Zero must-fix.
