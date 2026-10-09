-- G04-02 rollback: remove workspace authority tables and helper.
drop trigger if exists workspaces_updated_at on workspaces;
drop function if exists skelet_workspaces_updated_at();
drop table if exists workspace_members;
drop table if exists workspaces;
