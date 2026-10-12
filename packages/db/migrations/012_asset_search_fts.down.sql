-- AF-04 rollback: remove only the lexical search index introduced by 012.
drop index if exists artifacts_search_fts_idx;
