# Release Signing Procedure — Test Ceremony Proves the Path, Production Keys Stay Owner-Controlled

Status: PROCEDURE RECORD. Base: `814a2e4` (PR #137 merge).
Scope: gives P15/R7 "signed release artifacts" an executable,
fail-closed procedure without inventing a production release identity.
No product code changed by this grain beyond the script itself.

## The two modes

- Operator mode signs a real artifact with an operator-owned GPG key
  and verifies the signature in the same invocation:
  `node scripts/sign_release_artifact.mjs --artifact <file> --key <fingerprint> [--output <sig.asc>]`
  (exit 0 signed-and-verified, 1 verify-failed, 2 invalid input,
  3 tool unavailable; 64 MB artifact budget; key must be 16–40 hex chars).
- Self-test mode proves the whole path with an ephemeral GNUPGHOME,
  ephemeral ed25519 key, and fixture payload, then deletes all key
  material: `node scripts/sign_release_artifact.mjs --self-test`.
  CI and local qualification run this mode; it reads, stores, and
  prints no secret.

## What signatures mean here

- A `--self-test` signature proves the procedure works (key generation,
  detached armor signing, verification, cleanup). It is not a release
  identity and must never be cited as one.
- An operator-mode signature is attributable to whoever controls the
  key. Production release keys require an owner-controlled key ceremony
  (generation, storage, rotation, revocation) that this repo does not
  perform; until that ceremony exists, no artifact may be presented as
  an officially signed Skelet release.

## Proof

- `tests/node/release-signing.test.mjs` (2 tests): self-test round-trip
  (or honest exit-3 when `gpg` is absent) plus fail-closed invalid
  inputs with empty stdout. Auto-wired into the `bootstrap` CI job's
  node-test glob.
- Local 2026-10-16: self-test exit 0, `verified: true`.
