-- 20251230120000_snapshots_unique_key_source.sql
-- Enforce unique cache entries per key/source and add supporting index.

begin;

with ranked as (
  select
    id,
    row_number() over (
      partition by key, source
      order by updated_at desc, created_at desc
    ) as rn
  from public.snapshots
)
delete from public.snapshots s
using ranked r
where s.id = r.id
  and r.rn > 1;

create unique index if not exists snapshots_key_source_unique
  on public.snapshots (key, source);

create index if not exists snapshots_key_source_updated_at_idx
  on public.snapshots (key, source, updated_at desc);

commit;
