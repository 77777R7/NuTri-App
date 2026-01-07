-- 20260111120000_phase25_schema.sql
-- Phase 2.5 schema: canonical ingredient keys, citations, forms, and audit links.

begin;

alter table if exists public.ingredients
  add column if not exists canonical_key text,
  add column if not exists category text,
  add column if not exists goals text[];

create unique index if not exists ingredients_canonical_key_uq
  on public.ingredients (canonical_key);

create table if not exists public.citations (
  id text primary key,
  type text not null,
  identifier text,
  source text,
  title text,
  year int,
  url text,
  audit_status text not null default 'needs_review',
  accessed_at date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger citations_set_updated_at
before update on public.citations
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.ingredient_forms (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  form_key text not null,
  form_label text not null,
  relative_factor numeric(10,4) not null default 1.0,
  confidence numeric(6,4) not null default 0.5,
  evidence_grade text,
  audit_status text not null default 'needs_review',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists ingredient_forms_uq
  on public.ingredient_forms (ingredient_id, form_key);

create trigger ingredient_forms_set_updated_at
before update on public.ingredient_forms
for each row execute function public.set_current_timestamp_updated_at();

alter table if exists public.ingredient_forms
  add constraint ingredient_forms_confidence_check
  check (confidence >= 0 and confidence <= 1);

alter table if exists public.ingredient_forms
  add constraint ingredient_forms_relative_factor_check
  check (relative_factor > 0);

alter table if exists public.ingredient_evidence
  add column if not exists audit_status text not null default 'needs_review';

create table if not exists public.ingredient_evidence_citations (
  evidence_id uuid not null references public.ingredient_evidence (id) on delete cascade,
  citation_id text not null references public.citations (id) on delete restrict,
  primary key (evidence_id, citation_id)
);

create table if not exists public.ingredient_form_citations (
  form_id uuid not null references public.ingredient_forms (id) on delete cascade,
  citation_id text not null references public.citations (id) on delete restrict,
  primary key (form_id, citation_id)
);

commit;
