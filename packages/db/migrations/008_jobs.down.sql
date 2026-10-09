-- G05-01 rollback: remove the job queue lifecycle tables and helper.
drop trigger if exists jobs_updated_at on jobs;
drop function if exists skelet_jobs_updated_at();
drop table if exists jobs;
