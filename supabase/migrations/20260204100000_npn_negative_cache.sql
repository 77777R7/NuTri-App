-- 20260204100000_npn_negative_cache.sql
-- Add NPN negative cache + barcode raw columns for canonical key migration.

begin;

create table if not exists public.npn_negative_cache (
  npn text primary key,
  reason_code text not null,
  attempt_count int not null default 0,
  last_attempt_at timestamptz not null default now(),
  until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists npn_negative_cache_until_idx
  on public.npn_negative_cache (until desc);

create or replace function public.cleanup_expired_npn_negative_cache()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  delete from public.npn_negative_cache
  where until is not null and until < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter table public.npn_negative_cache enable row level security;
revoke all on table public.npn_negative_cache from anon, authenticated;
grant all on table public.npn_negative_cache to service_role;

drop policy if exists "service role full access" on public.npn_negative_cache;
create policy "service role full access"
on public.npn_negative_cache
for all
to service_role
using (true)
with check (true);

grant execute on function public.cleanup_expired_npn_negative_cache() to service_role;

alter table if exists public.barcode_regulatory_map
  add column if not exists barcode_raw text;

alter table if exists public.negative_cache
  add column if not exists barcode_raw text;

commit;
