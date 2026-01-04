-- 20260107124000_dedupe_lnhpd_raw_records.sql
-- Remove exact duplicate raw records, keeping newest fetched_at per endpoint + lnhpd_id + payload.

begin;

with ranked as (
  select
    id,
    row_number() over (
      partition by endpoint, lnhpd_id, payload
      order by fetched_at desc nulls last, id desc
    ) as rn
  from public.lnhpd_raw_records
)
delete from public.lnhpd_raw_records r
using ranked
where r.id = ranked.id
  and ranked.rn > 1;

commit;
