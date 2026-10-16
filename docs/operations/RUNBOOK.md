# Skelet Self-Hosted Operations Runbook

Status: canonical operator procedures for the supported zero-founder-spend
local and customer self-hosted modes. Managed SaaS remains explicitly not
offered until separately budgeted per the AF-00 deployment contract.

## 1. Backup

Production backup has two halves, taken together:

1. **PostgreSQL**: `pg_dump --format=custom --file=skelet-$DATE.dump $DATABASE_URL`
   (schema plus data, including the `schema_migrations` ledger and the
   immutable `import_records` ledger).
2. **Object storage**: filesystem snapshot of the content-addressed store
   root (plus `pg_dump` of nothing else — asset bytes live outside the
   database). Record the store root path and the dump file together; a
   dump without its store snapshot is an incomplete backup.

Retain dumps per customer policy. Dumps contain workspace content:
encrypt at rest and restrict access to operators.

## 2. Restore drill (executable, CI-verified)

Restore correctness — not just dump success — is proven by the committed
drill: `packages/db/src/backup.ts` with `backup-restore.test.mjs`
(PGlite) and `pg-backup-restore.test.mjs` (real PostgreSQL, CI
`db-foundation` job). The drill snapshots the corpus subgraph, wipes it
with `TRUNCATE ... CASCADE`, re-inserts the exact rows (original IDs
preserved, so stable `skelet://` URIs survive), and verifies row counts
plus id sets per table before declaring success.

Operator restore procedure:

1. Provision an empty database and run migrations to the release tag.
2. `pg_restore` the dump, then restore the store-root snapshot.
3. Run the drill's verify step (or the equivalent row-count/id-set
   comparison) before serving traffic.
4. Exercise the read path: search, `get_object`, flow listing, and a
   reference-pack recovery by URI.

The drill intentionally runs on scratch databases: the wipe cascades
to referencing rows (for example `collection_items` cascading from
artifacts), and row-level delete guards do not fire on `TRUNCATE`.
Production takedown of individual records uses row-level paths, never
this drill.

## 3. Rights takedown and derivative purge

1. Confirm the rights state (unknown, trademarked, or restricted bytes
   must never have served; verify serving-policy denials in logs).
2. Remove the canonical bytes from the store root and tombstone the
   record; purge thumbnails, caches, search projections, reference-pack
   exports, and kit ZIPs containing the bytes.
3. Re-run search and resolve paths to prove the bytes no longer serve
   while metadata-only records remain correctly labeled.
4. Record the action with actor, workspace, timestamp, and scope in the
   audit trail.

Per-item takedown automation beyond kit/board purge paths is a
follow-on grain; this runbook defines the manual procedure that automation
must implement.

## 4. Quotas, abuse response, and upgrades

- Quotas: per-workspace job budgets (capture page/depth/byte/time),
  candidate caps, rate limits, and idempotency ledgers are enforced in
  tests. On abuse: revoke the workspace credentials, cancel running
  jobs, expire outstanding leases, and re-verify quota denial before
  re-enabling.
- Abuse triage: collect the last window of `FORBIDDEN_OR_NOT_FOUND`,
  `QUOTA_EXCEEDED`, and `RATE_LIMITED` answers with workspace IDs and
  timestamps plus the stuck-job count, then evaluate with
  `evaluateAbuseAlarms` from `apps/web/lib/abuse-alarms.ts` (thresholds
  in `docs/operations/SLOS.md`) or the operator CLI
  `node --experimental-strip-types scripts/check_abuse_alarms.mjs --events <file.jsonl> [--stuck-jobs N] [--now ms]`
  (exit 0 ok, 1 elevated, 2 critical, 3 invalid input; 8 MB file and
  100 000-line budgets). `elevated` means investigate before the
  next release; `critical` means run the incident minimum below. The
  evaluator carries codes, counts, and workspace IDs only.
- Upgrades: apply forward migrations only (`migrateUp`); every
  migration ships a tested down file, but downgrades are rehearsal-only
  outside emergencies because the import ledger is append-only.
- Health: web `/api/health`, worker `health` command, and the
  `SKELET_NO_MODEL=1` gate (fails closed on forbidden credentials).

## 5. Incident minimum

Attribute every action to an authenticated identity, workspace, and
run/job ID. Preserve logs without secrets (tokens, cookies, keys, and
BYOK values are redacted by contract). This runbook plus the AF-12
qualification record is the incident starting point until a dedicated
on-call rotation exists (explicitly deferred, not silently assumed).
