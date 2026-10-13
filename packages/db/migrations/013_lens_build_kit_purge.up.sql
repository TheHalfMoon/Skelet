-- AF-05e-i: audited expiry purge of terminal Build Kit payloads.
--
-- Material finding: migration 009 permits the expiry purge transition in
-- the row trigger (terminal rows may clear artifact_manifest, checkpoint,
-- and result_evidence while preserving status, error, history, and
-- identity), but the kit_run_completed_artifacts and
-- kit_run_partial_observation table CHECKs reject the resulting rows:
-- expiring a completed run (or an evidence-only partial run) always fails
-- with a constraint violation. Retention was therefore unreachable for
-- exactly the runs it must cover.
--
-- Fix: both invariants gain a purged-row exception. Live (unpurged) rows
-- keep the original guarantees: completed runs always carry a manifest,
-- partial runs always carry evidence or an error classification.
alter table lens_build_kit_runs drop constraint kit_run_completed_artifacts;
alter table lens_build_kit_runs add constraint kit_run_completed_artifacts check(
 status <> 'completed' or purged_at is not null or artifact_manifest <> '{}'::jsonb);
alter table lens_build_kit_runs drop constraint kit_run_partial_observation;
alter table lens_build_kit_runs add constraint kit_run_partial_observation check(
 status <> 'partial' or purged_at is not null or
 result_evidence <> '{}'::jsonb or nullif(trim(error_class), '') is not null);
