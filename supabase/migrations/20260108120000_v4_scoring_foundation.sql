-- 20260108120000_v4_scoring_foundation.sql
-- Extend ingredients registry and add v4 scoring foundation tables.

begin;

alter table if exists public.ingredients
  add column if not exists ingredient_type text,
  add column if not exists units_supported text[];

create table if not exists public.ingredient_synonyms (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  synonym text not null,
  source text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger ingredient_synonyms_set_updated_at
before update on public.ingredient_synonyms
for each row execute function public.set_current_timestamp_updated_at();

create unique index if not exists ingredient_synonyms_unique
  on public.ingredient_synonyms (ingredient_id, lower(synonym));

create index if not exists ingredient_synonyms_ingredient_id_idx
  on public.ingredient_synonyms (ingredient_id);

create index if not exists ingredient_synonyms_synonym_lower_idx
  on public.ingredient_synonyms (lower(synonym));

create table if not exists public.ingredient_unit_conversions (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  from_unit text not null,
  to_unit text not null,
  factor numeric(18,8) not null,
  condition text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger ingredient_unit_conversions_set_updated_at
before update on public.ingredient_unit_conversions
for each row execute function public.set_current_timestamp_updated_at();

create unique index if not exists ingredient_unit_conversions_unique
  on public.ingredient_unit_conversions (ingredient_id, from_unit, to_unit, coalesce(condition, ''));

create index if not exists ingredient_unit_conversions_ingredient_id_idx
  on public.ingredient_unit_conversions (ingredient_id);

create table if not exists public.product_ingredients (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('dsld', 'lnhpd', 'ocr', 'manual')),
  source_id text not null,
  canonical_source_id text,
  ingredient_id uuid references public.ingredients (id) on delete set null,
  name_raw text not null,
  amount numeric(18,6),
  unit text,
  unit_raw text,
  amount_normalized numeric(18,6),
  unit_normalized text,
  basis text not null default 'label_serving'
    check (basis in ('label_serving', 'recommended_daily', 'assumed_daily')),
  is_active boolean not null default true,
  is_proprietary_blend boolean not null default false,
  amount_unknown boolean not null default false,
  form_raw text,
  parse_confidence numeric(5,4) check (parse_confidence >= 0 and parse_confidence <= 1),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger product_ingredients_set_updated_at
before update on public.product_ingredients
for each row execute function public.set_current_timestamp_updated_at();

create unique index if not exists product_ingredients_unique
  on public.product_ingredients (source, source_id, name_raw);

create index if not exists product_ingredients_source_idx
  on public.product_ingredients (source, source_id);

create index if not exists product_ingredients_canonical_source_idx
  on public.product_ingredients (canonical_source_id);

create index if not exists product_ingredients_ingredient_id_idx
  on public.product_ingredients (ingredient_id);

create table if not exists public.product_scores (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('dsld', 'lnhpd', 'ocr', 'manual')),
  source_id text not null,
  canonical_source_id text,
  score_version text not null,
  overall_score numeric(5,2),
  effectiveness_score numeric(5,2),
  safety_score numeric(5,2),
  integrity_score numeric(5,2),
  confidence numeric(4,3) check (confidence >= 0 and confidence <= 1),
  best_fit_goals jsonb,
  flags_json jsonb,
  highlights_json jsonb,
  explain_json jsonb,
  inputs_hash text,
  computed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger product_scores_set_updated_at
before update on public.product_scores
for each row execute function public.set_current_timestamp_updated_at();

create unique index if not exists product_scores_unique
  on public.product_scores (source, source_id);

create index if not exists product_scores_canonical_source_idx
  on public.product_scores (canonical_source_id);

create index if not exists product_scores_computed_at_idx
  on public.product_scores (computed_at);

commit;
