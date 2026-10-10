# G09-03 Lens Capture Worker — Qualification Record

Base: `70f12947af29dccdb1a324f48c8afb64d473b8fa`.
Branch: `skelet/p09-g09-03-capture-worker`.
Status: IMPLEMENTED, PENDING independent review and exact-head CI; **not merged**.

## Scoped change

- `skelet-lens` owns a disposable Node IPC worker with allowlisted environment
  and deadline/reaper, and a pinned `playwright-core@1.56.1` dependency.
- The only network ingestion path is a strict HTML-only HTTP(S) client with
  manually guarded redirects, DNS validation on every hop, pinned socket lookup,
  TLS hostname verification, 1 MB aggregate response-body budget, five
  redirect hops, and bounded network/worker/viewport deadlines.
- Chromium rendering uses a fresh context with JavaScript disabled, service
  workers blocked, all routed network requests denied, offline mode, and
  download rejection. Produces a small JPEG, observed DOM sections/links,
  content hash, and explicit incomplete-coverage fields.
- The screenshot is a **partial offline approximation**, never a
  pixel-faithful reproduction; no remote CSS/scripts/fonts/assets execute
  or download. Original HTML is never emitted in the IPC result.

## Locally executed checks (MacBook / Node 26)

- Strict TypeScript typecheck and ESLint: PASS.
- Lens tests: 48 total (8 URL guard, 29 design tokens, 10 guarded-network,
  1 real headless Chromium isolated-render fixture): PASS.
- Python bootstrap: 131/131 PASS.
- Live public-site smoke on `https://example.org/`: partial result,
  title `Example Domain`, real JPEG; HTTPS pin verified via direct client.
  This is a diagnostic smoke, not a deterministic CI assertion.
- Graft build/check: 910 nodes, 2,306 edges, graph in sync.
- CI Lens job updated to install the pinned Chromium headless shell and run
  the new hermetic capture suites. Initial PR #44 run 38031743967 had 47/48
  Lens tests pass: the browser test explicitly selected full Chromium while CI
  installed only the headless shell. The code/test now use Playwright's default
  headless executable selection; this repair needs a fresh exact-head CI run.

## Mandatory review record

- Alibaba OCR v1.12.13 official delegation preview: 7/8 reviewable files,
  `pnpm-lock.yaml` excluded by the tool's default path rule. Resolved
  workflow, package, and TS/JS rule sets. No paid/model-backed OCR scan is
  claimed; delegation is recorded as delegation, not an independent model.
- Genuine Jev 1.13.0: compatibility 0.27, correctness 0.42,
  evidence 0.29, reliability **0.70**, scope 0.54, security 0.20
  (higher = elevated probability of a problem for this spec).
  The reliability signal motivated conservative child SIGTERM then hard
  reaping, aggregate response-byte accounting and IPv6 literal coverage;
  these are engineering fixes, not a claim that Jev has cleared the gate.
- PStack v2.3 workflow sourced read-only from `phthomas/pstack` commit
  `faa4e9fb22e5cd19ac85ca094f6056ba89eaa701`.
  Attempted a fresh-context security judge with Codex CLI read-only, but
  the signed-in ChatGPT account reached its usage limit before review.
  **PStack verdict: NOT_RUN; mandatory gate remains OPEN.**

## Residual risks and explicit non-claims

- This is child-process and browser-context isolation, not a Linux cgroup,
  container, per-process filesystem jail, or kernel egress firewall.
  Production deployment of hostile URL rendering must add that boundary.
- SIGTERM gives Playwright a graceful browser-close window before SIGKILL;
  descendant process cleanup under worst-case browser hangs still requires
  OS-level supervisor/container proof before a production security claim.
- The scope is G09-03 capture foundation only. Providers, Design DNA report,
  job orchestration, tenant storage, and P09/P09b end-to-end workflows remain
  separate grains. No launch or phase-exit claim.
- Do not merge under the mandatory PStack/exact-head-review policy until the
  missing independent panel is available, any findings are fixed, and CI
  passes on the precise final head. Use normal merge commit only.
