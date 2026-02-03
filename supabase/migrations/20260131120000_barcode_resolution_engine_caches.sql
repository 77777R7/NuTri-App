-- 20260131120000_barcode_resolution_engine_caches.sql
-- Persistent caches + training log for Budgeted Resolution Engine (Stage 1 web resolution).

begin;

-- ============================================================================
-- SERP Cache (C layer)
-- ============================================================================

create table if not exists public.serp_cache (
  cache_key text primary key,
  barcode_gtin14 text not null,
  profile_id text not null,
  gl text,
  hl text,
  engine_version text not null,
  query text not null,
  results jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists serp_cache_barcode_expires_idx
  on public.serp_cache (barcode_gtin14, expires_at desc);

create index if not exists serp_cache_expires_idx
  on public.serp_cache (expires_at desc);

create or replace function public.cleanup_expired_serp_cache()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  delete from public.serp_cache
  where expires_at < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter table public.serp_cache enable row level security;
revoke all on table public.serp_cache from anon, authenticated;
grant all on table public.serp_cache to service_role;

drop policy if exists "service role full access" on public.serp_cache;
create policy "service role full access"
on public.serp_cache
for all
to service_role
using (true)
with check (true);

grant execute on function public.cleanup_expired_serp_cache() to service_role;

-- ============================================================================
-- Resolution Cache (B layer): barcode -> best_url (strongMatch only, enforced in app logic)
-- ============================================================================

create table if not exists public.resolution_cache (
  barcode_gtin14 text primary key,
  engine_version text not null,
  best_url text,
  best_domain text,
  signals jsonb,
  confidence double precision,
  success_count int not null default 0,
  fail_count int not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint resolution_cache_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists resolution_cache_expires_idx
  on public.resolution_cache (expires_at desc);

create index if not exists resolution_cache_updated_idx
  on public.resolution_cache (updated_at desc);

create or replace function public.cleanup_expired_resolution_cache()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  delete from public.resolution_cache
  where expires_at is not null and expires_at < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter table public.resolution_cache enable row level security;
revoke all on table public.resolution_cache from anon, authenticated;
grant all on table public.resolution_cache to service_role;

drop policy if exists "service role full access" on public.resolution_cache;
create policy "service role full access"
on public.resolution_cache
for all
to service_role
using (true)
with check (true);

grant execute on function public.cleanup_expired_resolution_cache() to service_role;

-- ============================================================================
-- Negative Cache (D layer): only used as Stage 1 web short-circuit
-- ============================================================================

create table if not exists public.negative_cache (
  barcode_gtin14 text primary key,
  reason_code text not null,
  until timestamptz not null,
  attempt_count int not null default 1,
  last_attempt_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists negative_cache_until_idx
  on public.negative_cache (until desc);

create or replace function public.cleanup_expired_negative_cache()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  delete from public.negative_cache
  where until < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter table public.negative_cache enable row level security;
revoke all on table public.negative_cache from anon, authenticated;
grant all on table public.negative_cache to service_role;

drop policy if exists "service role full access" on public.negative_cache;
create policy "service role full access"
on public.negative_cache
for all
to service_role
using (true)
with check (true);

grant execute on function public.cleanup_expired_negative_cache() to service_role;

-- ============================================================================
-- Regulatory Map: barcode -> NPN (Stage 0 LNHPD bootstrap)
-- ============================================================================

create table if not exists public.barcode_regulatory_map (
  barcode_gtin14 text primary key,
  npn text not null,
  confidence double precision not null default 0,
  source text not null,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint barcode_regulatory_map_confidence_range check (confidence >= 0 and confidence <= 1)
);

create index if not exists barcode_regulatory_map_expires_idx
  on public.barcode_regulatory_map (expires_at desc);

create or replace function public.cleanup_expired_barcode_regulatory_map()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  delete from public.barcode_regulatory_map
  where expires_at is not null and expires_at < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter table public.barcode_regulatory_map enable row level security;
revoke all on table public.barcode_regulatory_map from anon, authenticated;
grant all on table public.barcode_regulatory_map to service_role;

drop policy if exists "service role full access" on public.barcode_regulatory_map;
create policy "service role full access"
on public.barcode_regulatory_map
for all
to service_role
using (true)
with check (true);

grant execute on function public.cleanup_expired_barcode_regulatory_map() to service_role;

-- ============================================================================
-- Training Log (Stage 1 web resolution runs)
-- ============================================================================

create table if not exists public.barcode_resolution_training (
  id bigserial primary key,
  barcode_gtin14 text not null,
  engine_version text not null,
  stage0_outcome text not null, -- snapshot|catalog|lnhpd|miss
  query_profiles_used text[],
  serp_topk jsonb,
  selected_url text,
  selected_domain text,
  signals jsonb,
  facts_summary jsonb,
  facts_coverage double precision,
  timing jsonb,
  calls jsonb,
  cache_hits jsonb,
  outcome text not null, -- success_extract|fail_reason_code
  created_at timestamptz not null default now()
);

create index if not exists barcode_resolution_training_barcode_created_idx
  on public.barcode_resolution_training (barcode_gtin14, created_at desc);

create or replace function public.cleanup_expired_barcode_resolution_training(ttl_days int default 30)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  delete from public.barcode_resolution_training
  where created_at < now() - make_interval(days => ttl_days);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter table public.barcode_resolution_training enable row level security;
revoke all on table public.barcode_resolution_training from anon, authenticated;
grant all on table public.barcode_resolution_training to service_role;

drop policy if exists "service role full access" on public.barcode_resolution_training;
create policy "service role full access"
on public.barcode_resolution_training
for all
to service_role
using (true)
with check (true);

grant execute on function public.cleanup_expired_barcode_resolution_training(int) to service_role;

commit;

