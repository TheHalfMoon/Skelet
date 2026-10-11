# AF-01 PStack Fresh-Context Review and Fix Cycles

Review source: fresh-context read-only sessions over the 8 donor pins,
the UPSTREAMS.lock.yml additions, the authorization record, the donor-pins
fixture, the manifest with P10/P12/P14 include/exclude lists, the audit
document sections 1 through 11, and the 9-test conformance suite.
Specialized agent providers unavailable: the judges used inline bars,
not independent provider models. This record MUST NOT be described as
independent provider models. PStack binary functionality is unavailable
in this environment; this panel is the manual fresh-context PStack
equivalent required by governance, with unavailable functionality
reported here accurately.

Review basis: base `d07a8ea0b5073a4dda205a797084d2af3f730ba8` through
candidate head `6fd7f19aa6f79ddacf71fa81ae99bcc7a4703107`.
Targeted runs: `validate_upstreams` passed with 38 sources,
`test_craft_audit_af01` 9/9, full Python suite 144/144,
Node suites 39/39, `ci_hygiene` passed with 384 tracked files,
web lint and typecheck clean, `validate_build_kit`, `validate_skills`,
and `validate_registry` passed, Graft wiring graph built with 1242 nodes
and `check` OK.

## Must-fix (one defect found and closed pre-commit)

- **M1 — conformance test string mismatch.**
  The first draft asserted `Fair Source` with a space against
  `license_spdx` value `Fair-Source-WIP` with hyphens. Fixed by asserting
  `Fair-Source`. Proved by `test_craft_audit_af01` 9/9 green.

## Evidence-signal triage (closed pre-commit)

- First Jev pass: correctness 0.26, evidence 0.38, reliability 0.26,
  compatibility 0.15, security 0.11, scope 0.07 with no demonstrated
  defect. Triage re-read every pin against `git ls-remote` HEAD and the
  commits API trees, every license and NOTICE blob SHA against the
  contents API, every candidate path against the pinned trees, and every
  lock entry against the frozen fixture. The Fair Source versus open-source
  distinction is explicit for `artcraft-services`. Quarantined media,
  model, service, and trademark scopes stay restricted. No open defect.

## Worth considering (one accepted advisory)

- **A1 — Jev scores are probabilistic, not verdicts.**
  Post-repair band (0.07 to 0.38) sits below the 0.5 threshold with zero
  blocking findings; branch-by-branch review shows every changed path
  covered by a committed test or validator. ACCEPTED with the triage
  recorded here.

## Four-bar verdicts

- **Correctness: PASS** — 8 commits and trees match `ls-remote` plus API,
  license and NOTICE identities frozen, candidate P10/P12/P14 paths exist
  at those pins, dependency closures recorded without adding dependencies,
  manifests precise, caps set, strongest implementations named.
- **Parsimony: PASS** — docs, lock, manifests, and tests only. No runtime
  donor code, no migration, no UI, no provider activation, no billing, no
  paid AI, GPU, or cloud workload. Skelet collections stay canonical with
  boards as layout projections.
- **Product: PASS** — exactly the AF-01 slice: immutable audit, code versus
  asset separation, preserved notices, executable next-grain manifests for
  AF-02 through AF-12 and remaining P09b without hijacking launch scope.
- **Security: PASS** — founder code-only authorization with restricted
  data, assets, models, services, and trademarks; quarantined Nintendo
  sounds, memes, skyboxes, motion data, Mixamo renders, provider logos,
  OFL fonts, Lucide icons, SCOWL lists, Adobe CMaps, SAM weights, and
  brand marks excluded; no secret material; no new egress.

**Approved for exact-head CI qualification.** Merge remains conditional
on CI passing.
