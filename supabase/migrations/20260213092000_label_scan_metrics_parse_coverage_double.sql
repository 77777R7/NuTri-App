-- Ensure label_scan_metrics.parse_coverage stores ratios (0..1) as a float.
-- This migration is intentionally defensive because some environments may not
-- have the label_scan_metrics table created via migrations yet.

do $$
begin
  if to_regclass('public.label_scan_metrics') is null then
    raise notice 'label_scan_metrics table not found; skipping parse_coverage type change';
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'label_scan_metrics'
      and column_name = 'parse_coverage'
  ) then
    alter table public.label_scan_metrics
      alter column parse_coverage type double precision
      using parse_coverage::double precision;
  else
    raise notice 'label_scan_metrics.parse_coverage column not found; skipping type change';
  end if;
end $$;

