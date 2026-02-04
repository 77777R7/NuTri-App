-- 20260204123000_analysis_identity_jobs.sql
-- add job tracking columns + stale cleanup for analysis_identity_cache

begin;

alter table public.analysis_identity_cache
  add column if not exists attempts integer not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists last_error text,
  add column if not exists error_code text;

create index if not exists analysis_identity_cache_locked_until_idx
  on public.analysis_identity_cache (locked_until desc);

create or replace function public.cleanup_stale_analysis_identity_jobs(stale_minutes int default 5)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count int;
begin
  update public.analysis_identity_cache
  set status = 'error',
      error_code = 'STALE_PENDING',
      last_error = 'stale_pending_cleanup',
      updated_at = now()
  where status in ('pending', 'running')
    and updated_at < now() - make_interval(mins => stale_minutes);

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

grant execute on function public.cleanup_stale_analysis_identity_jobs(int) to service_role;

commit;
