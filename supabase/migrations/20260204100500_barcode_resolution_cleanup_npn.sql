-- 20260204100500_barcode_resolution_cleanup_npn.sql
-- Include NPN negative cache cleanup in daily job.

begin;

create or replace function public.run_barcode_resolution_cleanup_daily()
returns void
language plpgsql
as $$
begin
  perform public.cleanup_expired_resolution_cache();
  perform public.cleanup_expired_negative_cache();
  perform public.cleanup_expired_barcode_regulatory_map();
  perform public.cleanup_expired_npn_negative_cache();
  perform public.cleanup_expired_barcode_resolution_training(30);
end;
$$;

grant execute on function public.run_barcode_resolution_cleanup_daily() to service_role;

commit;
