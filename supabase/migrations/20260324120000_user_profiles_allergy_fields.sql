-- Draft migration for QA onboarding allergy input support.
-- Adds canonical allergy/restriction storage to user_profiles without
-- expanding the rest of the onboarding-v2 profile schema yet.

alter table public.user_profiles
  add column if not exists allergy_flags text[] not null default '{}'::text[],
  add column if not exists ingredient_restrictions text[] not null default '{}'::text[];

alter table public.user_profiles
  drop constraint if exists user_profiles_allergy_flags_allowed;

alter table public.user_profiles
  add constraint user_profiles_allergy_flags_allowed
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
  );

alter table public.user_profiles
  drop constraint if exists user_profiles_ingredient_restrictions_allowed;

alter table public.user_profiles
  add constraint user_profiles_ingredient_restrictions_allowed
  check (
    ingredient_restrictions <@ array[
      'gluten',
      'gelatin_animal_based'
    ]::text[]
  );

create index if not exists user_profiles_allergy_flags_gin
  on public.user_profiles
  using gin (allergy_flags);

create index if not exists user_profiles_ingredient_restrictions_gin
  on public.user_profiles
  using gin (ingredient_restrictions);

comment on column public.user_profiles.allergy_flags is
  'Canonical user allergy flags for personalized ingredient conflict matching.';

comment on column public.user_profiles.ingredient_restrictions is
  'Canonical non-allergen ingredient restrictions such as gluten or gelatin/animal-based.';
