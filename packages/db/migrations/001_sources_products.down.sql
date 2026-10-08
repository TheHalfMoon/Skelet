-- 001 DOWN: remove the canonical Source/Product/ProductVersion tables.
drop table if exists product_versions;
drop table if exists products;
drop table if exists sources;
