# G09-09 — Source-Linked Style Evidence and Capture-to-Report Wiring

Base: `19ed118475a229d5687cd0065fdc5dbfe23c4a57`.
Branch: `skelet/p09-g09-09-style-evidence`.
Status: IMPLEMENTED, PStack fresh-context review and exact-head CI pending.

## Intent and implemented scope

- New pure module `packages/lens/src/style-evidence.ts`: a 43-property
  computed-style allowlist mirroring the extractor contract, capture-side
  budgets (32 elements, 1,500 declarations, 256-char refs, 512-char values),
  fail-closed `collectStyleEvidence`, and deterministic ASCII `elementRef`.
- `capture-child.ts` collects bounded computed-style snapshots in the
  offline render (scripts disabled, remote resources blocked, inline
  `<style>` still applies) and projects them with `collectStyleEvidence`.
  Over-budget or malformed snapshots fail closed as `capture/browser`.
- `capture-worker.ts`: `CaptureResult` gains required `declarations`;
  new exported `validCaptureDeclarations` guards the IPC boundary,
  including index-based sparse-array rejection. Blast radius checked:
  no other source files construct or consume `CaptureResult`.
- `report-assembly.ts`: `validHtmlSource` requires valid declarations;
  new `assembleLensReportFromCapture` binds capture-attached evidence with
  `inputBasis: "capture-computed-styles"` and deterministic provenance
  `design-tokens-from-capture`. The caller-supplied path is byte-identical
  in behavior (same disclaimer text, same basis label).
- Tests: new `style-evidence.test.mjs` (10 tests: allowlist/order, budgets,
  refs, path projection, validator, real-Chromium offline attachment,
  truncation gap, capture-to-report binding, empty partial refusal, basis
  separation). `captured()` fixture gains `declarations: []`; rejection
  corpus gains malformed/over-budget/sparse declaration cases.
  `capture-browser` behavior unchanged.
- CI lens job lists the new test file (+1 line, no other workflow change).

## Evidence

- Lens Node tests: 74/74 PASS (64 prior + 10 new).
- Python bootstrap: 131/131 PASS.
- Strict Lens TypeScript + ESLint: PASS.
- Upstream validation: 30 sources PASS.
- Graft build/check: PASS; blast isolated to the lens package.
- Jev genuine `jev-1.13.0`: see `G09-09_JEV_SPEC.json` and
  `G09-09_JEV_REVIEW.json`. Probabilities for a problem:
  correctness 0.20, security 0.15, evidence 0.25,
  reliability 0.33, scope 0.35, compatibility 0.51.
  Scores are uncertainty indicators, not a substitute for tests or review.
  Compatibility is highest because `CaptureResult` gains a required field;
  all in-repo constructors were updated and no external consumer exists.
- Alibaba OCR v1.12.13: official delegation rules applied to new and
  edited TS plus the CI delta; no independent model-backed OCR scan claimed.
- PStack: fresh-context initial panel all four bars PASS with zero
  must-fix and seven advisories (A1–A4, A6–A7 fixed structurally, A5
  accepted as in-repo-only); independent delta review verified all
  closures with no new defects. See `G09-09_PSTACK_PANELS.md`.
- TesterArmy E2E: not executed; this grain exposes no new route/job/UI/MCP
  journey. The new capture path is qualified through the real-Chromium
  offline test. TesterArmy remains scheduled for P09b user-facing workflows.

## Explicit remaining work and limitations

- G09-09 wires capture evidence into the report core; DESIGN.md, Tailwind,
  shadcn, and agent-context exports remain future grains. Technology
  detection, rights verification, QA providers, and production OS
  sandboxing are still out of scope. No full-site reproduction is claimed.
- Computed values are hostile page data; downstream renderers/agents must
  preserve the data-vs-instruction boundary and escape output. DTCG export
  still omits unsafe font/shadow strings.
- Only inline and UA declarations are observed (scripts disabled, remote
  sheets blocked); pages whose design lives in external stylesheets
  report an honest partial with `no-qualified-style-tokens` where applicable.
- This commit remains subject to mandatory independent review and
  exact-head CI before normal merge, followed by post-merge verification.
