-- 20260107120000_cleanup_lnhpd_raw_active.sql
-- Keep only Active LNHPD raw records (flag_product_status = 1).

begin;

delete from public.lnhpd_raw_records r
where r.lnhpd_id is null
  or not exists (
    select 1
    from public.lnhpd_raw_records p
    where p.endpoint = 'ProductLicence'
      and p.lnhpd_id = r.lnhpd_id
      and p.payload->>'flag_product_status' = '1'
  )
  or (
    r.endpoint = 'ProductLicence'
    and coalesce(r.payload->>'flag_product_status', '') <> '1'
  );

commit;
