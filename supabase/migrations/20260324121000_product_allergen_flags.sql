-- Draft migration for derived product allergen/restriction flags.
-- This intentionally uses a separate table instead of mutating large source
-- tables such as product_ingredients or dsld_label_facts.

create table if not exists public.product_allergen_flags (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (
    source_kind in ('supplement', 'dsld_label', 'lnhpd', 'iherb_overlay')
  ),
  source_id text not null,
  allergy_flags text[] not null default '{}'::text[],
  ingredient_restrictions text[] not null default '{}'::text[],
  match_evidence jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source_kind, source_id),
  constraint product_allergen_flags_allergy_flags_allowed
    check (
      allergy_flags <@ array[
        'milk',
        'egg',
        'fish',
        'shellfish',
        'tree_nuts',
        'peanuts',
        'wheat',
        'soy',
        'sesame'
      ]::text[]
    ),
  constraint product_allergen_flags_restrictions_allowed
    check (
      ingredient_restrictions <@ array[
        'gluten',
        'gelatin_animal_based'
      ]::text[]
    )
);

create index if not exists product_allergen_flags_source_lookup_idx
  on public.product_allergen_flags (source_kind, source_id);

create index if not exists product_allergen_flags_allergy_gin
  on public.product_allergen_flags
  using gin (allergy_flags);

create index if not exists product_allergen_flags_restrictions_gin
  on public.product_allergen_flags
  using gin (ingredient_restrictions);

create index if not exists product_allergen_flags_computed_at_idx
  on public.product_allergen_flags (computed_at desc);

drop trigger if exists product_allergen_flags_set_updated_at on public.product_allergen_flags;

create trigger product_allergen_flags_set_updated_at
before update on public.product_allergen_flags
for each row execute function public.set_current_timestamp_updated_at();

alter table public.product_allergen_flags enable row level security;

revoke all on table public.product_allergen_flags from anon, authenticated;
grant all on table public.product_allergen_flags to service_role;

drop policy if exists "service role full access" on public.product_allergen_flags;

create policy "service role full access"
on public.product_allergen_flags
for all
to service_role
using (true)
with check (true);

comment on table public.product_allergen_flags is
  'Derived normalized allergen and ingredient restriction flags for products across supplement data sources.';

comment on column public.product_allergen_flags.match_evidence is
  'Evidence payload describing which raw label or ingredient sources produced each normalized flag.';
