# G09-03 Lens Capture Worker — Qualification Record

Base: `70f12947af29dccdb1a324f48c8afb64d473b8fa`.
Branch: `skelet/p09-g09-03-capture-worker`.
Status: CANONICAL. Merged to main as `9763c94a565278c26ab91c0de6d13c494f0193f0`
(PR #44, reviewed head `66d9a41af82aadc7ba7acc25f8a2b204e727c523`).
Exact-head CI run 38034610806 13/13 SUCCESS; post-merge main CI run
38035666792 SUCCESS (all 13 jobs).

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
- Lens tests: 49 total (8 URL guard, 29 design tokens, 10 guarded-network,
  2 real headless Chromium fixtures including a secret-free child launch): PASS.
- Python bootstrap: 131/131 PASS.
- Live public-site smoke on `https://example.org/`: partial result,
  title `Example Domain`, real JPEG; HTTPS pin verified via direct client.
  This is a diagnostic smoke, not a deterministic CI assertion.
- Graft build/check: 910 nodes, 2,306 edges, graph in sync.
- CI Lens job installs pinned Chromium headless shell. Initial PR #44 run
  38031743967 had 47/48 Lens tests pass because the test requested full
  Chromium while CI installed only the headless shell. Repair commit
  `2397c379472712252e2454ff31b3684600b3f48c` passed all 13/13 CI legs
  (run 38031954266), including Lens on Ubuntu and Windows storage.
  Follow-up child smoke uncovered Playwright browser-cache discovery under
  a deliberately private HOME. The allowlist now passes only the browser
  cache directory, and an actual child-launch fixture proves it can boot
  with no inherited credentials. The updated exact-head CI remains pending.

## Mandatory review record

- Alibaba OCR v1.12.13 official delegation preview: 9/11 reviewable files,
  `docs/reviews/G09-03_REVIEWS.md` excluded per unsupported-extension rule and
  `pnpm-lock.yaml` excluded per default path rule. Resolved workflow, package,
  and TS/JS rule sets and applied them to the exact diff: no typos, no dead
  code, explanatory comments on isolation/pinning logic, no `var`, strict
  equality, no `any`, null guards on IPC input, async error handling with
  static messages, no eval/innerHTML/document.write, no secrets in code or
  logs, no prototype modification. Zero blocking findings. No paid/model-backed
  OCR scan is claimed; delegation is recorded as delegation, not an
  independent model.
- Genuine Jev 1.13.0 exact-diff review, rerun on the final head:
  compatibility 0.27, correctness 0.42, evidence 0.28,
  reliability **0.69**, scope 0.54, security 0.21
  (higher = elevated probability of a problem for this spec).
  The reliability signal motivated conservative child SIGTERM then hard
  reaping, aggregate response-byte accounting and IPv6 literal coverage;
  these are engineering fixes, not a claim that Jev has cleared the gate.
  No new blocking signal after hardening.
- PStack v2.3 workflow sourced read-only from `phthomas/pstack` commit
  `faa4e9fb22e5cd19ac85ca094f6056ba89eaa701` (verified HEAD of upstream
  `main`). Ran the full fresh-context panel with independent judges:
  correctness PASS-WITH-NOTES, parsimony PASS-WITH-NOTES, product PASS,
  security PASS-WITH-NOTES. **Zero must-fix findings in any panel.**
  Panel notes were closed where security-relevant: removed the unchecked
  `executablePath` passthrough to `chromium.launch` (dead flexibility flagged
  by parsimony and security) and added parent-side IPC bounds on
  title/sections/assets matching child clipping limits. Focused delta
  re-review of that fix: security PASS, correctness PASS, zero must-fix.
  Accepted residuals (judge-rated worth-considering, not blocking): temp-home
  removal races the SIGTERM grace window after the result is delivered;
  resolver DNS lookups rely on the parent 22s worker deadline as backstop;
  `htmlBytes` reports final-hop bytes while the 1MB budget is enforced on the
  aggregate; remaining IPC metadata fields derive from the trusted ingress
  path.
- Graft 0.21.1 verified: build/check OK (910 nodes, 2,307 edges, in sync);
  blast radius isolated to the Lens capture area with no indexed dependents.
- TesterArmy e2e (upstream verified: https://github.com/tester-army/e2e,
  Apache-2.0): evaluated, not executed. This grain adds a pure offline capture
  module with no UI, route, worker-queue, or MCP surface; no new e2e journey
  exists to cover. Existing Playwright critical-path coverage is the Lens CI
  job with genuine Chromium fixtures, green on exact-head CI. Full TesterArmy
  integration remains scheduled with the P09b job lifecycle grains, where
  async user journeys first appear.

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
- Merge only on the exact reviewed head with green exact-head CI, via normal
  merge commit. Use post-merge main CI as the canonical closeout signal.
