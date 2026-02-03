-- 20260201090000_barcode_resolution_cleanup_cron.sql
-- Schedule cleanup jobs for barcode resolution caches/training.

begin;

create or replace function public.run_barcode_resolution_cleanup_daily()
returns void
language plpgsql
as $$
begin
  perform public.cleanup_expired_resolution_cache();
  perform public.cleanup_expired_negative_cache();
  perform public.cleanup_expired_barcode_regulatory_map();
  perform public.cleanup_expired_barcode_resolution_training(30);
end;
$$;

grant execute on function public.run_barcode_resolution_cleanup_daily() to service_role;

do $$
begin
  if to_regproc('cron.schedule') is not null then
    if exists (select 1 from cron.job where jobname = 'barcode_resolution_cleanup_hourly') then
      perform cron.unschedule((select jobid from cron.job where jobname = 'barcode_resolution_cleanup_hourly' limit 1));
    end if;
    perform cron.schedule(
      'barcode_resolution_cleanup_hourly',
      '10 * * * *',
      'select public.cleanup_expired_serp_cache();'
    );

    if exists (select 1 from cron.job where jobname = 'barcode_resolution_cleanup_daily') then
      perform cron.unschedule((select jobid from cron.job where jobname = 'barcode_resolution_cleanup_daily' limit 1));
    end if;
    perform cron.schedule(
      'barcode_resolution_cleanup_daily',
      '20 3 * * *',
      'select public.run_barcode_resolution_cleanup_daily();'
    );
  end if;
end;
$$;

commit;
