-- 20260107123000_lnhpd_quality_monitoring.sql
-- LNHPD quality snapshots and scheduled refresh/reporting helpers.

begin;

create table if not exists public.lnhpd_quality_snapshots (
  id bigserial primary key,
  captured_at timestamptz not null default timezone('utc', now()),
  active_total integer not null,
  active_complete integer not null,
  missing_medicinal integer not null,
  missing_nonmedicinal integer not null,
  missing_purpose integer not null
);

create index if not exists lnhpd_quality_snapshots_captured_at_idx
  on public.lnhpd_quality_snapshots (captured_at desc);

create or replace view public.lnhpd_quality_current as
select
  count(*) filter (where is_on_market = true) as active_total,
  count(*) filter (where is_on_market = true and is_complete = true) as active_complete,
  count(*) filter (
    where is_on_market = true
      and coalesce(missing_fields, '{}'::text[]) @> array['medicinal']
  ) as missing_medicinal,
  count(*) filter (
    where is_on_market = true
      and coalesce(missing_fields, '{}'::text[]) @> array['nonmedicinal']
  ) as missing_nonmedicinal,
  count(*) filter (
    where is_on_market = true
      and coalesce(missing_fields, '{}'::text[]) @> array['purpose']
  ) as missing_purpose
from public.lnhpd_facts;

create or replace view public.lnhpd_quality_latest as
select *
from public.lnhpd_quality_snapshots
order by captured_at desc
limit 1;

create or replace function public.record_lnhpd_quality_snapshot()
returns void
language sql
as $$
  insert into public.lnhpd_quality_snapshots (
    active_total,
    active_complete,
    missing_medicinal,
    missing_nonmedicinal,
    missing_purpose
  )
  select
    count(*) filter (where is_on_market = true) as active_total,
    count(*) filter (where is_on_market = true and is_complete = true) as active_complete,
    count(*) filter (
      where is_on_market = true
        and coalesce(missing_fields, '{}'::text[]) @> array['medicinal']
    ) as missing_medicinal,
    count(*) filter (
      where is_on_market = true
        and coalesce(missing_fields, '{}'::text[]) @> array['nonmedicinal']
    ) as missing_nonmedicinal,
    count(*) filter (
      where is_on_market = true
        and coalesce(missing_fields, '{}'::text[]) @> array['purpose']
    ) as missing_purpose
  from public.lnhpd_facts;
$$;

create or replace function public.run_lnhpd_refresh_and_report()
returns void
language plpgsql
as $$
declare
  got_lock boolean;
begin
  got_lock := pg_try_advisory_lock(81920001);
  if not got_lock then
    raise notice 'lnhpd refresh already running';
    return;
  end if;

  begin
    perform public.refresh_lnhpd_facts();
    perform public.record_lnhpd_quality_snapshot();
  exception
    when others then
      perform pg_advisory_unlock(81920001);
      raise;
  end;

  perform pg_advisory_unlock(81920001);
end;
$$;

do $$
begin
  if to_regproc('cron.schedule') is not null then
    if exists (select 1 from cron.job where jobname = 'lnhpd_refresh_daily') then
      perform cron.unschedule((select jobid from cron.job where jobname = 'lnhpd_refresh_daily' limit 1));
    end if;
    perform cron.schedule(
      'lnhpd_refresh_daily',
      '0 3 * * *',
      'select public.run_lnhpd_refresh_and_report();'
    );
  end if;
end;
$$;

commit;
