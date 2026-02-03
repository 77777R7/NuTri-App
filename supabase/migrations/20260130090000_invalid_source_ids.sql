-- 20260130090000_invalid_source_ids.sql
-- Track invalid source_ids (e.g., facts not found) so backfill can skip and stay auditable.

begin;

create table if not exists public.invalid_source_ids (
  source text not null,
  source_id text not null,
  reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists invalid_source_ids_source_source_id_key
  on public.invalid_source_ids (source, source_id);

commit;
