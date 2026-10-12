# AF-05a PStack Panels (manual fresh-context fallback)

- PStack binary unavailable in this environment (`which pstack` not found). No new paid model provider was activated to satisfy PStack. This record uses the repository-permitted manual fresh-context four-bar review fallback. It MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.34, correctness 0.66, evidence 0.47, reliability 0.24, scope 0.49, security 0.23 (model `jev-1.13.0`, ok true). Correctness elevation addressed below by targeted mechanism/test mapping.

## Correctness — PASS

- Viewport defaults to desktop in renderOfflineSource, capturePublicPage, and analyzePublicUrl; invalid viewport throws capture/blocked (child/parent) or lens/invalid-url (journey) with sanitized codes.
- Browser context uses 1280x720 desktop and 390x844 mobile with top-level deviceScaleFactor 1; child returns viewport in CaptureResult; parent requires result viewport equals requested viewport; IPC rejects malformed viewport; report requires desktop/mobile.
- Dimensions proven by inspectJpeg on real offline Chromium renders (desktop 1280x720, mobile 390x844); invalid viewport rejects without launching a browser; entrypoint validates before fork; journey passes viewport to capture for both paths with invalid rejection.
- Jev correctness 0.66 probe: most likely broad-meter sensitivity to the viewport plumbing plus test expansion; disproven as a defect by the dimension tests, binding tests, and gate tests above. Zero must-fix remaining.

## Parsimony — PASS

- One viewport type per module (duplicate one-line union, no new dependency); one binding check in parent; one gate in report; one option in journey. No second capture path, no new service, no donor import, no traversal/manifest/ZIP/starter change.
- Old callers omitting viewport keep working via desktop defaults; test fixtures updated to desktop explicitly. No unrelated refactor.

## Product — PASS

- Fits AF-05 responsive capture requirement; preserves offline JS-disabled route-blocked render for both viewports; coverageGaps unchanged (viewport-only-screenshot still accurate per capture).
- Required behaviors wired: desktop and mobile captures use intended dimensions with source-to-artifact viewport binding; journey service exposes viewport option with fail-closed invalid handling. No new product surface beyond the viewport option.

## Security — PASS

- Failure messages stay static sanitized codes (capture/blocked, capture/browser, lens/invalid-url); no stacks, secrets, paths, HTML, or credentials in viewport, IPC, or journey errors.
- Offline render guarantees preserved for both viewports (route abort, setOffline, JS disabled, no downloads, reduced motion). Parent mismatch fails as capture/browser without leaking internals.
- Zero must-fix remaining. Graft blast shows 11 files in 1 area, 0 outside dependents; spawned-process undercount noted per precedent (Chromium child), with real Chromium tests as coverage evidence.
