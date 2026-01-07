-- 20260111123000_dataset_import_audit.sql
-- Import audit runs and issue queue for dataset ingestion.

begin;

create table if not exists public.ingredient_dataset_import_runs (
  id uuid primary key default gen_random_uuid(),
  dataset_version text,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  strict boolean not null default false,
  stats_json jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger ingredient_dataset_import_runs_set_updated_at
before update on public.ingredient_dataset_import_runs
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.ingredient_dataset_import_issues (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ingredient_dataset_import_runs (id) on delete cascade,
  severity text not null,
  issue_type text not null,
  canonical_key text,
  ingredient_id uuid references public.ingredients (id) on delete set null,
  message text not null,
  payload_json jsonb,
  status text not null default 'open',
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz
);

create index if not exists ingredient_dataset_import_issues_run_idx
  on public.ingredient_dataset_import_issues (run_id);

create index if not exists ingredient_dataset_import_issues_status_idx
  on public.ingredient_dataset_import_issues (status);

commit;
