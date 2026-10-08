-- G03-02 rollback: reverse only objects introduced by migration 002.
drop trigger if exists skelet_source_graph_guard on sources;
drop trigger if exists skelet_product_graph_guard on products;
drop trigger if exists skelet_version_graph_guard on product_versions;
drop trigger if exists skelet_artifact_graph_guard on artifacts;
drop trigger if exists skelet_asset_graph_guard on assets;
drop trigger if exists skelet_pattern_graph_guard on patterns;
drop trigger if exists relations_validate_endpoints on relations;
drop table if exists relations;
drop function if exists skelet_guard_graph_endpoint_delete();
drop function if exists skelet_validate_relation();
drop function if exists skelet_graph_ref_exists(text, uuid);
drop table if exists patterns;
drop table if exists assets;
drop table if exists artifacts;
drop index if exists product_versions_product_id_id_uq;
