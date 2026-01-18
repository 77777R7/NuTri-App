-- 20260114120000_parsing_rules_tables.sql
-- Parsing rules and token alias tables for form normalization.

begin;

create table if not exists public.normalization_rules (
  rule_id text primary key,
  pattern text not null,
  replacement text not null,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger normalization_rules_set_updated_at
before update on public.normalization_rules
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.token_aliases (
  id uuid primary key default gen_random_uuid(),
  token_raw text not null,
  token_normalized text not null,
  alias_confidence numeric(5,4),
  notes text,
  ingredient_id uuid references public.ingredients (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists token_aliases_uq
  on public.token_aliases (
    token_normalized,
    coalesce(ingredient_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists token_aliases_token_norm_idx
  on public.token_aliases (token_normalized);

create trigger token_aliases_set_updated_at
before update on public.token_aliases
for each row execute function public.set_current_timestamp_updated_at();

alter table if exists public.token_aliases
  add constraint token_aliases_confidence_check
  check (alias_confidence is null or (alias_confidence >= 0 and alias_confidence <= 1));

create table if not exists public.generic_form_tokens (
  id uuid primary key default gen_random_uuid(),
  token_raw text not null,
  token_normalized text not null,
  alias_confidence numeric(5,4),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists generic_form_tokens_uq
  on public.generic_form_tokens (token_normalized);

create trigger generic_form_tokens_set_updated_at
before update on public.generic_form_tokens
for each row execute function public.set_current_timestamp_updated_at();

alter table if exists public.generic_form_tokens
  add constraint generic_form_tokens_confidence_check
  check (alias_confidence is null or (alias_confidence >= 0 and alias_confidence <= 1));

commit;
