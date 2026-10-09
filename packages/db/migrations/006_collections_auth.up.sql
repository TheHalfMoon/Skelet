-- G04-03: bind collections to workspace authority. Existing G03-03 rows
-- are unaffected (constraint is validated on write); orphans cannot be
-- created going forward. No billing or public API is activated here.
alter table collections
 add constraint collections_workspace_fk
 foreign key (workspace_id) references workspaces(id) on delete cascade;
