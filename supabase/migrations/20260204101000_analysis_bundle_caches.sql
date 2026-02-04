-- 20260204101000_analysis_bundle_caches.sql
-- analysis identity cache + web canonical evidence map

begin;

-- ==========================================================================
-- analysis_identity_cache
-- ==========================================================================

create table if not exists public.analysis_identity_cache (
  identity_type text not null,
  identity_value text not null,
  locale text not null,
  prompt_version text not null,
  facts_digest_hash text not null,
  facts_source_version text not null,
  section text not null,
  status text not null,
  payload jsonb,
  facts_digest_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (identity_type, identity_value, locale, prompt_version, facts_digest_hash, section)
);

create index if not exists analysis_identity_cache_expires_idx
  on public.analysis_identity_cache (expires_at desc);

create or replace function public.cleanup_expired_analysis_identity_cache()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  delete from public.analysis_identity_cache
  where expires_at is not null and expires_at < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter table public.analysis_identity_cache enable row level security;
revoke all on table public.analysis_identity_cache from anon, authenticated;
grant all on table public.analysis_identity_cache to service_role;

drop policy if exists "service role full access" on public.analysis_identity_cache;
create policy "service role full access"
on public.analysis_identity_cache
for all
to service_role
using (true)
with check (true);

grant execute on function public.cleanup_expired_analysis_identity_cache() to service_role;

-- ==========================================================================
-- web_canonical_map
-- ==========================================================================

create table if not exists public.web_canonical_map (
  barcode_gtin14 text not null,
  engine_version text not null,
  canonical_urls jsonb not null,
  canonical_hash text not null,
  best_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (barcode_gtin14, engine_version)
);

create index if not exists web_canonical_map_expires_idx
  on public.web_canonical_map (expires_at desc);

create or replace function public.cleanup_expired_web_canonical_map()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  delete from public.web_canonical_map
  where expires_at is not null and expires_at < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter table public.web_canonical_map enable row level security;
revoke all on table public.web_canonical_map from anon, authenticated;
grant all on table public.web_canonical_map to service_role;

drop policy if exists "service role full access" on public.web_canonical_map;
create policy "service role full access"
on public.web_canonical_map
for all
to service_role
using (true)
with check (true);

grant execute on function public.cleanup_expired_web_canonical_map() to service_role;

-- ==========================================================================
-- Update cleanup job
-- ==========================================================================

create or replace function public.run_barcode_resolution_cleanup_daily()
returns void
language plpgsql
as $$
begin
  perform public.cleanup_expired_resolution_cache();
  perform public.cleanup_expired_negative_cache();
  perform public.cleanup_expired_barcode_regulatory_map();
  perform public.cleanup_expired_npn_negative_cache();
  perform public.cleanup_expired_analysis_identity_cache();
  perform public.cleanup_expired_web_canonical_map();
  perform public.cleanup_expired_barcode_resolution_training(30);
end;
$$;

grant execute on function public.run_barcode_resolution_cleanup_daily() to service_role;

commit;
