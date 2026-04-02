create table if not exists public.personalization_bundle_runs (
  id uuid primary key default gen_random_uuid(),
  artifact_kind text not null,
  schema_version text not null,
  rules_version text not null,
  source_table text not null,
  source_row_count integer not null default 0 check (source_row_count >= 0),
  prepared_candidate_count integer not null default 0 check (prepared_candidate_count >= 0),
  not_enough_structured_data_count integer not null default 0 check (not_enough_structured_data_count >= 0),
  artifact_path text,
  generated_at timestamptz not null,
  build_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists personalization_bundle_runs_kind_generated_idx
  on public.personalization_bundle_runs (artifact_kind, generated_at desc);

create table if not exists public.personalization_candidate_gaps (
  id uuid primary key default gen_random_uuid(),
  bundle_run_id uuid not null references public.personalization_bundle_runs (id) on delete cascade,
  product_id text not null,
  source_product_id text,
  title text,
  brand_name text,
  facts_status text not null check (facts_status in ('none', 'partial', 'full')),
  gap_codes text[] not null default '{}'::text[],
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (bundle_run_id, product_id)
);

create index if not exists personalization_candidate_gaps_run_created_idx
  on public.personalization_candidate_gaps (bundle_run_id, created_at desc);

create index if not exists personalization_candidate_gaps_codes_gin
  on public.personalization_candidate_gaps
  using gin (gap_codes);

alter table public.personalization_bundle_runs enable row level security;
alter table public.personalization_candidate_gaps enable row level security;
