-- G04-03: bind collections to workspace authority. PostgreSQL validates
-- existing rows when the constraint is added (clean on a fresh launch
-- database); orphans cannot be created going forward. No billing or
-- public API is activated here.
alter table collections
 add constraint collections_workspace_fk
 foreign key (workspace_id) references workspaces(id) on delete cascade;
