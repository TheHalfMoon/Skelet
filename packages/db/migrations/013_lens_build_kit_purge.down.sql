-- AF-05e-i rollback: restore the pre-purge CHECK definitions from 009.
-- Precondition: no purged rows (purged_at is null everywhere), otherwise
-- re-adding the strict CHECKs fails closed on the purged payloads.
alter table lens_build_kit_runs drop constraint kit_run_partial_observation;
alter table lens_build_kit_runs add constraint kit_run_partial_observation check(
 status <> 'partial' or
 result_evidence <> '{}'::jsonb or nullif(trim(error_class), '') is not null);
alter table lens_build_kit_runs drop constraint kit_run_completed_artifacts;
alter table lens_build_kit_runs add constraint kit_run_completed_artifacts check(
 status <> 'completed' or artifact_manifest <> '{}'::jsonb);
