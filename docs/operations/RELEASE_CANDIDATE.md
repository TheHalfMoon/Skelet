# Skelet v1 Local Release-Candidate Preparation (Procedure, Not a Publication)

Status: CANONICAL RC PROCEDURE. Base: `0198c4b` (PR #144 merge).
Scope: how the v1 Local release candidate is built, verified, and handed to the owner signing ceremony. No release tag is created and nothing is published by this grain. Machine-checked by `tests/node/release-candidate.test.mjs` (builder behavior) and `tests/test_release_candidate_doc.py` (document completeness).

## 1. Deliverable format decision

Skelet v1 Local is a web/worker/PostgreSQL stack, not a desktop binary. The release candidate is therefore a **reproducible source release**:

1. Lockfile-pinned source tarball (`git archive HEAD` + deterministic `gzip -n -9`).
2. `manifest.json` (version proposal, commit, file inventory, artifact + SBOM digests, signing/license state).
3. `SHA256SUMS` (tarball + SBOM digests).
4. CycloneDX SBOM (`sbom.json`, freshness-enforced in tree).
5. Provenance (`UPSTREAMS.lock.yml` + `CODE_PROVENANCE.md` + `DATA_PROVENANCE.md`).
6. Operator docs (`CLEAN_INSTALL.md`, `RUNBOOK.md`, `RELEASE_SIGNING.md`, `SLOS.md`).
7. Database migration package (forward migrations in tree, rehearsed up/down/up).
8. Environment guidance (`CLEAN_INSTALL.md` §2; no secrets required).

No desktop binary is invented. No hosted service is required to consume the candidate.

## 2. Versioning

- Proposed candidate label: `v1.0.0-local-rc.1`. This is a **proposal only**.
- `package.json` stays `0.1.0` and no git tag is created until OD-03 (owner approves the version identifier + authorizes the release-candidate tag/draft).
- Prior tags: none exist in this repository (`git tag --list` is empty at the time of writing); the proposal cannot conflict with a prior release.

## 3. Build and verify (operator commands)

```bash
node scripts/build_release_candidate.mjs --out /tmp/skelet-rc --version v1.0.0-local-rc.1
cat /tmp/skelet-rc/manifest.json
cat /tmp/skelet-rc/SHA256SUMS
(cd /tmp/skelet-rc && sha256sum -c SHA256SUMS)
```

Measured probe at `0198c4b` (local, 2026-10-16): 962 tracked files, 1,134,573-byte tarball, exit 0. Digests are per-commit: regenerate on the exact RC commit at signing time; never reuse a digest across commits.

## 4. Archive contents control

The builder fails closed (exit 2) when any tracked path matches the forbidden list: `.env`, `.pem`, `.key`, `credentials.json`, `secrets.json`, `id_rsa`, `id_ed25519`, `node_modules/`, `.ignore`. It refuses archives over 256 MB and requires `sbom.json` to exist. `node_modules` is never tracked, so dependencies arrive via the frozen lockfile at install time, not inside the tarball. Test data stays limited to intentionally small fixtures (binary media lives outside Git per `ARCHITECTURE.md`); donor assets were excluded at import time and remain rights-gated at serving time.

## 5. Integrity after packaging

The consumer proof is the clean-install procedure on the candidate digest: isolated checkout of the exact commit (or tarball extraction), `CLEAN_INSTALL.md` §§6–15, health + smoke + starter + registry proofs. Repository build success alone never validates the package.

## 6. Gaps requiring owner decisions

- **OD-05 (new, license): no root `LICENSE` file and no consolidated `NOTICE` file exist in this repository.** Provenance obligations are recorded per-source (`UPSTREAMS.lock.yml`, `docs/provenance/`, `CODE/DATA_PROVENANCE.md`), but the candidate cannot ship license/attribution notices until the owner (a) chooses the Skelet license, (b) authorizes a consolidated `NOTICE` (upstream copyrights + required attribution + third-party exclusions from Issue #62 gate 7), and (c) places both at the release root. The builder manifest records `license: pending owner decision OD-05` and must never be read as granting license terms. This blocks a *final* release, not RC preparation.
- **OD-02 (signing):** the candidate is explicitly unsigned (`signed: false`). Digests above are generated for the owner ceremony; `sign_release_artifact.mjs --self-test` proves the workflow with ephemeral keys only.
- **OD-03 (release):** version identifier, release-candidate tag/draft, and any publication await explicit owner approval.

## 7. Changelog and support boundary (candidate)

- Supported features / absent features: `V1_LOCAL_ACCEPTANCE_CONTRACT.md` §4 (user-facing truth).
- Supported platforms: macOS + ubuntu-24.04 CI; Windows unclaimed beyond the storage job.
- Known limitations: `AF-12_FINAL_RERUN_4.md` verdict + `CLEAN_INSTALL_PROOF.md` boundaries + 1 accepted-risk advisory (braces 3.0.3, no upstream patch).
- Upgrade/migration guidance: forward migrations only (`migrateUp`); downgrades are rehearsal-only (RUNBOOK §4); import ledger is append-only.
