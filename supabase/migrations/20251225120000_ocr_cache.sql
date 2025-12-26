-- 20251225120000_ocr_cache.sql
-- Creates OCR cache table used by backend/src/ocrCache.ts

begin;

create table if not exists public.ocr_cache (
  image_hash text primary key,
  vision_raw jsonb,
  parsed_ingredients jsonb not null,
  analysis jsonb,
  confidence double precision not null default 0,
  created_at timestamptz not null default now(),
  constraint ocr_cache_confidence_range check (confidence >= 0 and confidence <= 1)
);

create index if not exists ocr_cache_created_at_idx
  on public.ocr_cache (created_at);

-- Delete rows older than ttl_days; returns deleted row count.
create or replace function public.cleanup_expired_ocr_cache(ttl_days int default 30)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  delete from public.ocr_cache
  where created_at < now() - make_interval(days => ttl_days);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- RLS: recommended. Cache is backend-owned; do not allow anon/auth clients to write.
alter table public.ocr_cache enable row level security;

revoke all on table public.ocr_cache from anon, authenticated;
grant all on table public.ocr_cache to service_role;

-- Policy is optional because service_role bypasses RLS, but keeping it explicit is fine.
drop policy if exists "service role full access" on public.ocr_cache;
create policy "service role full access"
on public.ocr_cache
for all
to service_role
using (true)
with check (true);

grant execute on function public.cleanup_expired_ocr_cache(int) to service_role;

commit;
