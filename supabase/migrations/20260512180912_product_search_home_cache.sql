begin;

create table if not exists public.product_search_home_cache (
  cache_key text primary key,
  payload jsonb not null,
  indexed_rows integer not null default 0,
  source_indexed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.product_search_home_cache enable row level security;
revoke all on table public.product_search_home_cache from anon, authenticated;
grant all on table public.product_search_home_cache to service_role;

drop policy if exists "service role full access" on public.product_search_home_cache;
create policy "service role full access"
on public.product_search_home_cache
for all
to service_role
using (true)
with check (true);

commit;
