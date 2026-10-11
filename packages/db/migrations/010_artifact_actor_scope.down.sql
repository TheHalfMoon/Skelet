-- AF-SEC-00 rollback: reverse only objects introduced by migration 010.
alter table artifacts drop constraint if exists artifact_owner_format;
alter table artifacts drop constraint if exists artifact_owner_needs_workspace;
drop index if exists artifacts_workspace_idx;
alter table artifacts drop column if exists owner_subject;
alter table artifacts drop column if exists workspace_id;
