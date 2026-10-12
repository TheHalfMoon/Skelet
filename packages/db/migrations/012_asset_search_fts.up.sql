-- AF-04: indexed deterministic lexical search for the canonical asset registry.
-- Use the immutable regconfig overload so PostgreSQL can index the expression.
-- Some embedded runtimes omit GIN/FTS support; skip only those specific
-- capability failures. The application retains a literal LIKE fallback.
do $$
begin
  begin
    execute $index$
      create index artifacts_search_fts_idx
      on artifacts using gin (
        to_tsvector(
          'simple',
          coalesce(title, '') || ' ' ||
          coalesce(summary, '') || ' ' ||
          coalesce(canonical_text, '') || ' ' ||
          coalesce(metadata->>'collection', '') || ' ' ||
          coalesce(metadata->>'ref', '')
        )
      )
    $index$;
  exception
    when undefined_function or feature_not_supported or undefined_object then
      null;
  end;
end
$$;
