-- 20260105121000_expire_incomplete_snapshots.sql
-- Force-refresh incomplete barcode snapshots so cache can self-heal.

begin;

update public.snapshots
set expires_at = timezone('utc', now())
where source = 'barcode'
  and (expires_at is null or expires_at > timezone('utc', now()))
  and (
    (payload_json->'analysis'->>'status') in ('catalog_only', 'label_enriched')
    or analysis_json is null
    or (analysis_json->'efficacy' is null or analysis_json->'safety' is null or analysis_json->'usagePayload' is null)
    or (
      jsonb_array_length(coalesce(payload_json->'label'->'actives', '[]'::jsonb)) = 0
      and jsonb_array_length(coalesce(payload_json->'label'->'proprietaryBlends', '[]'::jsonb)) = 0
      and (payload_json->'label'->'extraction') is null
    )
  );

commit;
