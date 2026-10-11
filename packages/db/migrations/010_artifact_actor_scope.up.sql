-- AF-SEC-00: actor-scoped artifact authorization.
-- Artifacts gain an optional workspace binding plus owner so private and
-- workspace-visible design evidence can be authorized server-side instead of
-- leaking through guessed IDs. Global rows (workspace_id IS NULL) remain for
-- the public asset corpus; non-public global rows are fail-closed at read
-- time by application policy, never by silent publication.
alter table artifacts add column workspace_id uuid references workspaces(id) on delete restrict;
alter table artifacts add column owner_subject text;
create index artifacts_workspace_idx on artifacts(workspace_id);
-- An owner claim without a workspace binding is meaningless: it can neither
-- be membership-checked nor revoked with the workspace.
alter table artifacts add constraint artifact_owner_needs_workspace
  check (owner_subject is null or workspace_id is not null);
alter table artifacts add constraint artifact_owner_format
  check (owner_subject is null or
    (length(trim(owner_subject)) > 0 and char_length(owner_subject) <= 128));
