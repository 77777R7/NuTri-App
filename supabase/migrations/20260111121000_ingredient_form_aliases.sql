-- 20260111121000_ingredient_form_aliases.sql
-- Phase 2.5: form alias table for controlled matching.

begin;

create table if not exists public.ingredient_form_aliases (
  id uuid primary key default gen_random_uuid(),
  alias_text text not null,
  alias_norm text not null,
  form_key text not null,
  ingredient_id uuid references public.ingredients (id) on delete cascade,
  confidence numeric(6,4),
  audit_status text not null default 'needs_review',
  source text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists ingredient_form_aliases_uq
  on public.ingredient_form_aliases (alias_norm, coalesce(ingredient_id, '00000000-0000-0000-0000-000000000000'::uuid), form_key);

create index if not exists ingredient_form_aliases_alias_norm_idx
  on public.ingredient_form_aliases (alias_norm);

create trigger ingredient_form_aliases_set_updated_at
before update on public.ingredient_form_aliases
for each row execute function public.set_current_timestamp_updated_at();

alter table if exists public.ingredient_form_aliases
  add constraint ingredient_form_aliases_confidence_check
  check (confidence is null or (confidence >= 0 and confidence <= 1));

commit;
