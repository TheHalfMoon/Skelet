-- G09b-02 rollback: remove the Lens Build Kit job lifecycle tables and helper.
drop trigger if exists lens_kit_runs_updated_at on lens_build_kit_runs;
drop function if exists skelet_kit_runs_updated_at();
drop trigger if exists lens_kit_run_transition on lens_build_kit_runs;
drop trigger if exists lens_kit_run_insert on lens_build_kit_runs;
drop function if exists skelet_kit_run_transition_guard();
drop table if exists lens_build_kit_quotas;
drop table if exists lens_build_kit_runs;
