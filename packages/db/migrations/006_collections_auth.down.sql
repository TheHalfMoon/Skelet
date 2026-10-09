-- G04-03 rollback: drop workspace authority binding on collections.
alter table collections drop constraint if exists collections_workspace_fk;
