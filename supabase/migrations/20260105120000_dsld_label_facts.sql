-- 20260105120000_dsld_label_facts.sql
-- Structured DSLD facts cache and lookup RPCs.

begin;

create table if not exists public.dsld_label_facts (
  dsld_label_id integer primary key,
  facts_json jsonb not null,
  dataset_version text,
  extracted_at timestamptz not null default timezone('utc', now())
);

create index if not exists dsld_label_facts_dsld_label_id_idx
  on public.dsld_label_facts (dsld_label_id);

create or replace function public.resolve_dsld_facts_by_label_id(p_label_id integer)
returns table (
  dsld_label_id integer,
  facts_json jsonb,
  dataset_version text,
  extracted_at timestamptz
)
language sql
stable
as $$
  select f.dsld_label_id, f.facts_json, f.dataset_version, f.extracted_at
  from public.dsld_label_facts f
  where f.dsld_label_id = p_label_id
  limit 1;
$$;

create or replace function public.resolve_dsld_facts_by_gtin14(p_gtin14 text)
returns table (
  dsld_label_id integer,
  facts_json jsonb,
  dataset_version text,
  extracted_at timestamptz
)
language sql
stable
as $$
  select f.dsld_label_id, f.facts_json, f.dataset_version, f.extracted_at
  from public.dsld_barcode_canonical b
  join public.dsld_label_facts f
    on f.dsld_label_id = b.canonical_dsld_label_id
  where b.barcode_normalized_gtin14 = p_gtin14
  limit 1;
$$;

commit;
