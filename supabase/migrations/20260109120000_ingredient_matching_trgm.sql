-- 20260109120000_ingredient_matching_trgm.sql
-- Enable trigram matching, add matching metadata, and normalize ingredient keys.

begin;

create extension if not exists pg_trgm;

create index if not exists ingredients_name_trgm_idx
  on public.ingredients using gin (name gin_trgm_ops);

create index if not exists ingredient_synonyms_synonym_trgm_idx
  on public.ingredient_synonyms using gin (synonym gin_trgm_ops);

alter table if exists public.product_ingredients
  add column if not exists name_key text,
  add column if not exists unit_kind text,
  add column if not exists match_method text,
  add column if not exists match_confidence numeric(5,4);

alter table if exists public.product_ingredients
  add constraint product_ingredients_match_confidence_check
  check (match_confidence is null or (match_confidence >= 0 and match_confidence <= 1));

alter table if exists public.product_ingredients
  add constraint product_ingredients_unit_kind_check
  check (unit_kind is null or unit_kind in ('mass','volume','iu','cfu','percent','homeopathic','unknown'));

update public.product_ingredients
set name_key = coalesce(
  nullif(btrim(regexp_replace(lower(name_raw), '[^a-z0-9]+', ' ', 'g')), ''),
  lower(btrim(name_raw))
)
where name_key is null;

update public.product_ingredients
set unit_kind = case
  when coalesce(unit_normalized, unit) is null then 'unknown'
  when lower(coalesce(unit_normalized, unit)) in ('mcg','ug','mg','g') then 'mass'
  when lower(coalesce(unit_normalized, unit)) = 'ml' then 'volume'
  when lower(coalesce(unit_normalized, unit)) = 'iu' then 'iu'
  when lower(coalesce(unit_normalized, unit)) = 'cfu' then 'cfu'
  when lower(coalesce(unit_normalized, unit)) in ('x','c','ch','d','dh','lm','mk','ck','mt') then 'homeopathic'
  when lower(coalesce(unit_normalized, unit)) = '%'
    or lower(coalesce(unit_normalized, unit)) like '%percent%'
    or lower(coalesce(unit_normalized, unit)) like '%dv%' then 'percent'
  else 'unknown'
end
where unit_kind is null;

with ranked as (
  select
    id,
    source,
    source_id,
    basis,
    name_key,
    row_number() over (
      partition by source, source_id, basis, name_key
      order by
        (ingredient_id is not null) desc,
        (amount is not null) desc,
        (unit is not null) desc,
        (parse_confidence is not null) desc,
        updated_at desc,
        created_at desc
    ) as rn,
    bool_or(is_active) over (partition by source, source_id, basis, name_key) as any_active,
    bool_or(is_proprietary_blend) over (partition by source, source_id, basis, name_key) as any_blend,
    bool_or(amount_unknown) over (partition by source, source_id, basis, name_key) as any_unknown,
    max(parse_confidence) over (partition by source, source_id, basis, name_key) as max_parse_confidence,
    max(match_confidence) over (partition by source, source_id, basis, name_key) as max_match_confidence
  from public.product_ingredients
)
update public.product_ingredients p
set
  is_active = r.any_active,
  is_proprietary_blend = r.any_blend,
  amount_unknown = r.any_unknown,
  parse_confidence = r.max_parse_confidence,
  match_confidence = r.max_match_confidence
from ranked r
where p.id = r.id
  and r.rn = 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by source, source_id, basis, name_key
      order by
        (ingredient_id is not null) desc,
        (amount is not null) desc,
        (unit is not null) desc,
        (parse_confidence is not null) desc,
        updated_at desc,
        created_at desc
    ) as rn
  from public.product_ingredients
)
delete from public.product_ingredients p
using ranked r
where p.id = r.id
  and r.rn > 1;

alter table if exists public.product_ingredients
  alter column name_key set not null;

drop index if exists public.product_ingredients_unique;

create unique index if not exists product_ingredients_unique_key
  on public.product_ingredients (source, source_id, basis, name_key);

create or replace function public.resolve_ingredient_lookup(query_text text)
returns table (
  ingredient_id uuid,
  canonical_name text,
  base_unit text,
  match_method text,
  match_confidence numeric(5,4)
)
language sql
stable
as $$
  with normalized as (
    select nullif(btrim(query_text), '') as q
  ),
  exact_ingredient as (
    select
      i.id as ingredient_id,
      i.name as canonical_name,
      i.unit as base_unit,
      'exact'::text as match_method,
      1.0::numeric(5,4) as match_confidence
    from public.ingredients i
    join normalized n on n.q is not null
    where lower(i.name) = lower(n.q)
    limit 1
  ),
  exact_synonym as (
    select
      i.id as ingredient_id,
      i.name as canonical_name,
      i.unit as base_unit,
      'synonym'::text as match_method,
      0.97::numeric(5,4) as match_confidence
    from public.ingredient_synonyms s
    join public.ingredients i on i.id = s.ingredient_id
    join normalized n on n.q is not null
    where lower(s.synonym) = lower(n.q)
    limit 1
  ),
  trgm_ingredient as (
    select
      i.id as ingredient_id,
      i.name as canonical_name,
      i.unit as base_unit,
      'trgm'::text as match_method,
      similarity(lower(i.name), lower(n.q))::numeric(5,4) as match_confidence
    from public.ingredients i
    join normalized n on n.q is not null
    where similarity(lower(i.name), lower(n.q)) >= 0.35
    order by match_confidence desc
    limit 1
  ),
  trgm_synonym as (
    select
      i.id as ingredient_id,
      i.name as canonical_name,
      i.unit as base_unit,
      'trgm'::text as match_method,
      similarity(lower(s.synonym), lower(n.q))::numeric(5,4) as match_confidence
    from public.ingredient_synonyms s
    join public.ingredients i on i.id = s.ingredient_id
    join normalized n on n.q is not null
    where similarity(lower(s.synonym), lower(n.q)) >= 0.35
    order by match_confidence desc
    limit 1
  ),
  candidates as (
    select * from exact_ingredient
    union all
    select * from exact_synonym
    union all
    select * from trgm_ingredient
    union all
    select * from trgm_synonym
  )
  select ingredient_id, canonical_name, base_unit, match_method, match_confidence
  from candidates
  order by
    case match_method when 'exact' then 1 when 'synonym' then 2 else 3 end,
    match_confidence desc
  limit 1;
$$;

commit;
