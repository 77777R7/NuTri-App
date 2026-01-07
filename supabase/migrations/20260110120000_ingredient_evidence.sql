-- 20260110120000_ingredient_evidence.sql
-- Phase 2: evidence-by-goal table for dose adequacy.

begin;

create table if not exists public.ingredient_evidence (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  goal text not null,
  min_effective_dose numeric,
  optimal_dose_range numrange,
  evidence_grade text,
  audit_status text not null default 'needs_review',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists ingredient_evidence_uq
  on public.ingredient_evidence (ingredient_id, goal);

create index if not exists ingredient_evidence_ingredient_idx
  on public.ingredient_evidence (ingredient_id);

create trigger ingredient_evidence_set_updated_at
before update on public.ingredient_evidence
for each row execute function public.set_current_timestamp_updated_at();

alter table if exists public.ingredient_evidence
  add constraint ingredient_evidence_min_dose_check
  check (min_effective_dose is null or min_effective_dose >= 0);

commit;
