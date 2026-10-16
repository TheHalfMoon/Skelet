-- 018 rollback: rename canonical skilit_* database objects back to legacy
-- skelet_* names. Only used when rolling back the rebrand migration;
-- normal operation never runs this path.

DO $$
DECLARE
  new_names text[] := ARRAY[
    'skilit_graph_ref_exists',
    'skilit_validate_relation',
    'skilit_guard_graph_endpoint_delete',
    'skilit_flow_source_guard',
    'skilit_flow_step_integrity',
    'skilit_run_insert_guard',
    'skilit_run_transition_guard',
    'skilit_import_target_guard',
    'skilit_import_immutable',
    'skilit_import_ref_delete_guard',
    'skilit_flow_parent_guard',
    'skilit_users_updated_at',
    'skilit_workspaces_updated_at',
    'skilit_subscriptions_updated_at',
    'skilit_jobs_updated_at',
    'skilit_kit_run_transition_guard',
    'skilit_kit_runs_updated_at'
  ];
  new_name text;
  old_name text;
  func_oid oid;
BEGIN
  FOREACH new_name IN ARRAY new_names LOOP
    old_name := 'skelet_' || substring(new_name from 8);
    IF new_name = 'skilit_graph_ref_exists' THEN
      SELECT oid INTO func_oid FROM pg_proc WHERE proname = new_name;
      IF func_oid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = old_name) THEN
        EXECUTE format('ALTER FUNCTION %I(text, uuid) RENAME TO %I', new_name, old_name);
      END IF;
    ELSE
      SELECT oid INTO func_oid FROM pg_proc WHERE proname = new_name;
      IF func_oid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = old_name) THEN
        EXECUTE format('ALTER FUNCTION %I() RENAME TO %I', new_name, old_name);
      END IF;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'skilit_source_graph_guard') THEN
    ALTER TRIGGER skilit_source_graph_guard ON sources RENAME TO skelet_source_graph_guard;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'skilit_product_graph_guard') THEN
    ALTER TRIGGER skilit_product_graph_guard ON products RENAME TO skelet_product_graph_guard;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'skilit_version_graph_guard') THEN
    ALTER TRIGGER skilit_version_graph_guard ON product_versions RENAME TO skelet_version_graph_guard;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'skilit_artifact_graph_guard') THEN
    ALTER TRIGGER skilit_artifact_graph_guard ON artifacts RENAME TO skelet_artifact_graph_guard;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'skilit_asset_graph_guard') THEN
    ALTER TRIGGER skilit_asset_graph_guard ON assets RENAME TO skelet_asset_graph_guard;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'skilit_pattern_graph_guard') THEN
    ALTER TRIGGER skilit_pattern_graph_guard ON patterns RENAME TO skelet_pattern_graph_guard;
  END IF;
END $$;
