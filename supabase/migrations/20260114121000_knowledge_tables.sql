-- 20260114121000_knowledge_tables.sql
-- Knowledge layer tables for interactions, targets, and dose response curves.

begin;

create table if not exists public.interactions (
  interaction_id text primary key,
  interaction_type text,
  ingredient_a_id uuid references public.ingredients (id) on delete set null,
  ingredient_b_id uuid references public.ingredients (id) on delete set null,
  ingredient_a_key text,
  ingredient_b_key text,
  ingredient_a_name text,
  ingredient_b_name text,
  direction text,
  condition_logic text,
  condition_json jsonb,
  effect_type text,
  effect_value numeric,
  affected_pillar text,
  rationale text,
  evidence_grade text,
  audit_status text not null default 'needs_review',
  rule_confidence numeric(5,4),
  reference_ids text[],
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists interactions_ingredient_a_idx
  on public.interactions (ingredient_a_id);

create index if not exists interactions_ingredient_b_idx
  on public.interactions (ingredient_b_id);

create trigger interactions_set_updated_at
before update on public.interactions
for each row execute function public.set_current_timestamp_updated_at();

alter table if exists public.interactions
  add constraint interactions_confidence_check
  check (rule_confidence is null or (rule_confidence >= 0 and rule_confidence <= 1));

create table if not exists public.nutrient_targets (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid references public.ingredients (id) on delete cascade,
  ingredient_key text,
  target_type text,
  target_value numeric,
  unit text,
  jurisdiction text,
  authority text,
  reference_ids text[],
  audit_status text not null default 'needs_review',
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists nutrient_targets_uq
  on public.nutrient_targets (ingredient_id, target_type, jurisdiction, authority);

create index if not exists nutrient_targets_ingredient_idx
  on public.nutrient_targets (ingredient_id);

create trigger nutrient_targets_set_updated_at
before update on public.nutrient_targets
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.target_profiles (
  profile_id text primary key,
  profile_name text,
  description text,
  default_for text,
  audit_status text not null default 'needs_review',
  reference_ids text[],
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger target_profiles_set_updated_at
before update on public.target_profiles
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.ul__toxicity (
  ul_id text primary key,
  ingredient_id uuid references public.ingredients (id) on delete cascade,
  ingredient_key text,
  population text,
  age_range text,
  authority text,
  ul_value numeric,
  unit text not null,
  scope text,
  confidence numeric(5,4),
  audit_status text not null default 'needs_review',
  reference_ids text[],
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ul_toxicity_ingredient_idx
  on public.ul__toxicity (ingredient_id);

create trigger ul_toxicity_set_updated_at
before update on public.ul__toxicity
for each row execute function public.set_current_timestamp_updated_at();

alter table if exists public.ul__toxicity
  add constraint ul_toxicity_confidence_check
  check (confidence is null or (confidence >= 0 and confidence <= 1));

create table if not exists public.dose_response_curves (
  curve_id text primary key,
  ingredient_id uuid references public.ingredients (id) on delete cascade,
  ingredient_key text,
  curve_type text,
  beneficial_min numeric,
  target_value numeric,
  target_unit text,
  plateau_start numeric,
  plateau_end numeric,
  ul_value numeric,
  ul_unit text,
  ul_scope text,
  penalty_start numeric,
  penalty_slope numeric,
  score_midpoint numeric,
  score_cap numeric,
  notes text,
  audit_status text not null default 'needs_review',
  reference_ids text[],
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists dose_response_curves_ingredient_idx
  on public.dose_response_curves (ingredient_id);

create trigger dose_response_curves_set_updated_at
before update on public.dose_response_curves
for each row execute function public.set_current_timestamp_updated_at();

commit;
