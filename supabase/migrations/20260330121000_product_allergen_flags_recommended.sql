-- Recommended derived product allergen flags migration.
-- Aligns product identity with the existing source/source_id pattern already
-- used by product_scores and product_ingredients in the live main project.

create table if not exists public.product_allergen_flags (
  source text not null
    check (source in ('dsld', 'lnhpd', 'ocr', 'iherb_overlay')),
  source_id text not null,
  canonical_source_id text,
  allergy_flags text[] not null default '{}'::text[],
  ingredient_restrictions text[] not null default '{}'::text[],
  coverage_status text not null default 'insufficient'
    check (coverage_status in ('resolved', 'partial', 'insufficient')),
  match_evidence jsonb not null default '{}'::jsonb,
  normalization_version text not null default 'allergen_norm_v1',
  computed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (source, source_id),
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

create index if not exists product_allergen_flags_canonical_source_idx
  on public.product_allergen_flags (canonical_source_id);

create index if not exists product_allergen_flags_coverage_status_idx
  on public.product_allergen_flags (coverage_status);

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
  'Derived normalized allergen and ingredient restriction flags keyed by source/source_id for product-level conflict matching.';

comment on column public.product_allergen_flags.coverage_status is
  'resolved = enough label data to decide, partial = some label evidence but incomplete, insufficient = not enough label detail to decide.';

comment on column public.product_allergen_flags.match_evidence is
  'JSON evidence payload keyed by canonical flag with matched source fields, snippets, and confidence.';

comment on column public.product_allergen_flags.normalization_version is
  'Normalization ruleset version used to compute this row, for targeted re-backfills.';
