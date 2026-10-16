-- 018 Skilit rebrand: rename legacy skelet_* database functions and triggers
-- to canonical skilit_* identifiers for existing installs.
--
-- Fresh installs run renamed 001-017 migrations and already have skilit_*
-- objects; this migration is a safe no-op there (old names absent).
-- Existing installs ran 001-017 with skelet_* names; this renames them
-- in place so persisted data remains recoverable with zero loss.
-- All renames are idempotent: old names are renamed only when present
-- and canonical names are absent.

DO $$
DECLARE
  func_names text[] := ARRAY[
    'skelet_graph_ref_exists',
    'skelet_validate_relation',
    'skelet_guard_graph_endpoint_delete',
    'skelet_flow_source_guard',
    'skelet_flow_step_integrity',
    'skelet_run_insert_guard',
    'skelet_run_transition_guard',
    'skelet_import_target_guard',
    'skelet_import_immutable',
    'skelet_import_ref_delete_guard',
    'skelet_flow_parent_guard',
    'skelet_users_updated_at',
    'skelet_workspaces_updated_at',
    'skelet_subscriptions_updated_at',
    'skelet_jobs_updated_at',
    'skelet_kit_run_transition_guard',
    'skelet_kit_runs_updated_at'
  ];
  old_name text;
  new_name text;
  func_oid oid;
BEGIN
  FOREACH old_name IN ARRAY func_names LOOP
    new_name := 'skilit_' || substring(old_name from 8);
    -- Rename zero-arg trigger functions; graph_ref_exists has (text, uuid).
    IF old_name = 'skelet_graph_ref_exists' THEN
      SELECT oid INTO func_oid FROM pg_proc WHERE proname = old_name;
      IF func_oid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = new_name) THEN
        EXECUTE format('ALTER FUNCTION %I(text, uuid) RENAME TO %I', old_name, new_name);
      END IF;
    ELSE
      SELECT oid INTO func_oid FROM pg_proc WHERE proname = old_name;
      IF func_oid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = new_name) THEN
        EXECUTE format('ALTER FUNCTION %I() RENAME TO %I', old_name, new_name);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Rename legacy triggers to canonical names where present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'skelet_source_graph_guard') THEN
    ALTER TRIGGER skelet_source_graph_guard ON sources RENAME TO skilit_source_graph_guard;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'skelet_product_graph_guard') THEN
    ALTER TRIGGER skelet_product_graph_guard ON products RENAME TO skilit_product_graph_guard;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'skelet_version_graph_guard') THEN
    ALTER TRIGGER skelet_version_graph_guard ON product_versions RENAME TO skilit_version_graph_guard;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'skelet_artifact_graph_guard') THEN
    ALTER TRIGGER skelet_artifact_graph_guard ON artifacts RENAME TO skilit_artifact_graph_guard;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'skelet_asset_graph_guard') THEN
    ALTER TRIGGER skelet_asset_graph_guard ON assets RENAME TO skilit_asset_graph_guard;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'skelet_pattern_graph_guard') THEN
    ALTER TRIGGER skelet_pattern_graph_guard ON patterns RENAME TO skilit_pattern_graph_guard;
  END IF;
END $$;
