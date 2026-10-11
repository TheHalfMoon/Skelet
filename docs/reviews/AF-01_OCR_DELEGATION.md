# AF-01 Alibaba OCR Delegation Record (not an LLM-backed scan)

- Grain: AF-01, branch `skelet/af01-craft-audit`, base
  `d07a8ea0b5073a4dda205a797084d2af3f730ba8`, head
  `6fd7f19aa6f79ddacf71fa81ae99bcc7a4703107` at implementation commit.
- OCR version: open-code-review v1.12.13 (fabbdb29) darwin/arm64. No OCR LLM
  provider credential is configured in this environment, so the official
  `ocr delegate` workflow was used per `GOVERNANCE.md`.
- `ocr delegate preview --from <base> --to HEAD`: 4 reviewable / 6 total.
  Reviewable: `UPSTREAMS.lock.yml` (+208/-0),
  `docs/provenance/authorizations/craft-suite-2026-10-11.json` (+46/-0),
  `imports/craft-suite/donor-pins.json` (+147/-0),
  `imports/craft-suite/manifest.json` (+225/-0).
  Excluded by OCR itself: `docs/provenance/CRAFT_SUITE_AUDIT_AF01_2026-10-11.md`
  (`unsupported_ext`) and `tests/test_craft_audit_af01.py` (`default_path`).
  The markdown audit is covered by the inline four-bar PStack panel and the
  green conformance suites. The Python test is covered by the hosted bootstrap
  unittest suite (144 tests including 9 new AF-01 tests) and local Node suites.
- Delegated rules executed against the exact diff (`ocr delegate rule`):
  - Group YAML (`UPSTREAMS.lock.yml`): key-spelling check; values ignored.
    All 8 new source objects contain exactly the required keys
    (`id`, `source_url`, `source_kind`, `role`, `status`, `capability`,
    `permission_basis`, `license`, `pin_policy`, `exact_commit_or_release`,
    `verification_date`, `rights_scope`, `imported_paths`, `modifications`).
    No unknown fields. No missing fields. IDs match
    `^[a-z0-9][a-z0-9-]*$`. Pins are full 40-hex. Dates are ISO and not
    future. No finding.
  - Group JSON (authorization plus donor-pins plus manifest): key-spelling
    check; values ignored. Authorization keys, donor-pin keys
    (`schema_version`, `grain`, `base_sha`, `verification_date`,
    `verification_method`, `donors`, `equivalence_note`, `rights_separation`,
    `no_runtime_import`, `no_paid_dependency`), and manifest keys
    (`schema_version`, `grain`, `source`, `base_sha`, `verification_date`,
    `state`, `activation_allowed`, `next_grain_allowed`,
    `authorization_record`, `donor_pins`, `audit_record`, `rights_gate`,
    `rights_quarantine`, `notices_to_preserve`, `import_manifests`,
    `performance_baseline`, `cve_and_dependency_notes`,
    `skelet_authoritative`) are spelled consistently with the checked-in
    fixtures and the Python conformance tests that parse them. No finding.
- Findings: zero unresolved blocking findings. This record MUST NOT be
  described as an LLM-backed OCR scan.
