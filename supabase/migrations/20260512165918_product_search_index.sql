-- Lightweight Product Search index.
-- Keeps user-facing search off the wide iHerb overlay row during cold paths.

begin;

create extension if not exists pg_trgm;

create table if not exists public.product_search_index (
  id bigserial primary key,
  overlay_id bigint unique,
  product_id text not null unique,
  brand_name text not null,
  title text not null,
  upc_code text,
  barcode_gtin14 text,
  image_url text,
  categories jsonb not null default '[]'::jsonb,
  ingredients jsonb not null default '[]'::jsonb,
  primary_facts_amount text,
  serving_size text,
  description text,
  suggested_use text,
  search_text text not null,
  ingredient_families text[] not null default '{}'::text[],
  form_signals text[] not null default '{}'::text[],
  strength_signals text[] not null default '{}'::text[],
  facts_status text not null default 'none',
  coverage_status text not null default 'not_enough_structured_data',
  brand_popularity integer not null default 0,
  quality_rank integer not null default 0,
  source_updated_at timestamptz,
  indexed_at timestamptz not null default now(),
  constraint product_search_index_gtin14_format_chk
    check (barcode_gtin14 is null or barcode_gtin14 ~ '^[0-9]{14}$'),
  constraint product_search_index_facts_status_chk
    check (facts_status in ('full', 'partial', 'none')),
  constraint product_search_index_coverage_status_chk
    check (coverage_status in ('coverage_ready', 'not_enough_structured_data'))
);

create index if not exists product_search_index_search_text_trgm_idx
  on public.product_search_index using gin (search_text gin_trgm_ops);

create index if not exists product_search_index_brand_idx
  on public.product_search_index (brand_name);

create index if not exists product_search_index_barcode_idx
  on public.product_search_index (barcode_gtin14);

create index if not exists product_search_index_upc_idx
  on public.product_search_index (upc_code);

create index if not exists product_search_index_families_idx
  on public.product_search_index using gin (ingredient_families);

create index if not exists product_search_index_forms_idx
  on public.product_search_index using gin (form_signals);

create index if not exists product_search_index_strengths_idx
  on public.product_search_index using gin (strength_signals);

create index if not exists product_search_index_quality_idx
  on public.product_search_index (quality_rank desc, brand_popularity desc, source_updated_at desc);

alter table public.product_search_index enable row level security;
revoke all on table public.product_search_index from anon, authenticated;
grant all on table public.product_search_index to service_role;

drop policy if exists "service role full access" on public.product_search_index;
create policy "service role full access"
on public.product_search_index
for all
to service_role
using (true)
with check (true);

create or replace function public.refresh_product_search_index()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  refreshed_count integer;
begin
  with upserted as (
  insert into public.product_search_index (
    overlay_id,
    product_id,
    brand_name,
    title,
    upc_code,
    barcode_gtin14,
    image_url,
    categories,
    ingredients,
    primary_facts_amount,
    serving_size,
    description,
    suggested_use,
    search_text,
    ingredient_families,
    form_signals,
    strength_signals,
    facts_status,
    coverage_status,
    brand_popularity,
    quality_rank,
    source_updated_at,
    indexed_at
  )
  select
    p.id as overlay_id,
    p.product_id,
    p.brand_name,
    p.title,
    p.upc_code,
    p.barcode_gtin14,
    coalesce(p.product_catalog_image, p.product_images->>0) as image_url,
    coalesce(p.categories, '[]'::jsonb) as categories,
    fact_source.nutritional_facts as ingredients,
    facts.first_amount as primary_facts_amount,
    coalesce(
      nullif(p.supplement_facts->>'servingSize', ''),
      nullif(p.supplement_facts->>'serving_size', ''),
      nullif(p.serving->>'servingSize', ''),
      nullif(p.serving->>'serving_size', ''),
      nullif(p.serving->>'size', ''),
      nullif(p.serving->>'label', '')
    ) as serving_size,
    coalesce(
      nullif(p.description_sections->>'description', ''),
      nullif(p.description_sections->>'Description', '')
    ) as description,
    coalesce(
      nullif(p.description_sections->>'suggested use', ''),
      nullif(p.description_sections->>'Suggested Use', ''),
      nullif(p.description_sections->>'suggested usage', ''),
      nullif(p.description_sections->>'Suggested Usage', ''),
      nullif(p.description_sections->>'suggested use.', '')
    ) as suggested_use,
    lower(
      regexp_replace(
        concat_ws(
          ' ',
          p.brand_name,
          p.title,
          p.upc_code,
          p.barcode_gtin14,
          p.categories::text,
          fact_source.nutritional_facts::text,
          p.description_sections::text,
          case when search_source.normalized_text ~ '(^|[^a-z0-9])(melatonin|glycine|valerian|gaba|magnesium|theanine|sleep|calm)([^a-z0-9]|$)' then 'sleep calm rest' end,
          case when search_source.normalized_text ~ '(^|[^a-z0-9])(coq10|caffeine|b12|b complex|iron|mitochondria|electrolyte|energy)([^a-z0-9]|$)' then 'energy fatigue electrolyte' end,
          case when search_source.normalized_text ~ '(^|[^a-z0-9])(vitamin c|zinc|elderberry|echinacea|immune|immunity|vitamin d|probiotic)([^a-z0-9]|$)' then 'immune immunity defense' end,
          case when search_source.normalized_text ~ '(^|[^a-z0-9])(protein|creatine|collagen|bcaa|eaa|recovery|muscle|performance|glutamine)([^a-z0-9]|$)' then 'recovery muscle performance' end,
          case when search_source.normalized_text ~ '(^|[^a-z0-9])(bacopa|lion s mane|lions mane|choline|phosphatidylserine|focus|theanine|rhodiola|cognition)([^a-z0-9]|$)' then 'focus cognition brain' end,
          case when search_source.normalized_text ~ '(^|[^a-z0-9])(ashwagandha|rhodiola|stress|calm|magnesium|theanine|mood)([^a-z0-9]|$)' then 'stress calm mood' end,
          case when search_source.normalized_text ~ '(^|[^a-z0-9])(berberine|glucomannan|appetite|glp 1|weight|metabolic|fiber|thermogenic)([^a-z0-9]|$)' then 'weight metabolic appetite' end,
          case when search_source.normalized_text ~ '(^|[^a-z0-9])(maca|tongkat|tribulus|horny goat|libido|sexual|testosterone)([^a-z0-9]|$)' then 'libido sexual vitality' end
        ),
        '[^a-zA-Z0-9]+',
        ' ',
        'g'
      )
    ) as search_text,
    array_remove(array[
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(vitamin d|d3|cholecalciferol)([^a-z0-9]|$)' then 'vitamin_d' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(vitamin c|ascorbic|ascorbate)([^a-z0-9]|$)' then 'vitamin_c' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(vitamin a|retinol|beta carotene)([^a-z0-9]|$)' then 'vitamin_a' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(vitamin e|tocopherol|tocotrienol)([^a-z0-9]|$)' then 'vitamin_e' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(vitamin k|vitamin k1|vitamin k2|mk 7|menaquinone)([^a-z0-9]|$)' then 'vitamin_k' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(vitamin b12|b12|cobalamin)([^a-z0-9]|$)' then 'vitamin_b12' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(omega 3|omega3|fish oil|krill oil|epa|dha)([^a-z0-9]|$)' then 'omega_3' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])magnesium([^a-z0-9]|$)' then 'magnesium' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])zinc([^a-z0-9]|$)' then 'zinc' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])calcium([^a-z0-9]|$)' then 'calcium' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])iron([^a-z0-9]|$)' then 'iron' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])probiotics?([^a-z0-9]|$)' then 'probiotic' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(protein|whey|collagen|casein|pea protein)([^a-z0-9]|$)' then 'protein' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])creatine([^a-z0-9]|$)' then 'creatine' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(ashwagandha|sensoril|ksm 66)([^a-z0-9]|$)' then 'ashwagandha' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])melatonin([^a-z0-9]|$)' then 'melatonin' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(turmeric|curcumin)([^a-z0-9]|$)' then 'turmeric' end
    ], null) as ingredient_families,
    array_remove(array[
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(d3|cholecalciferol)([^a-z0-9]|$)' then 'd3' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(glycinate|bisglycinate)([^a-z0-9]|$)' then 'glycinate' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])citrate([^a-z0-9]|$)' then 'citrate' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])malate([^a-z0-9]|$)' then 'malate' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(threonate|l threonate)([^a-z0-9]|$)' then 'threonate' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])oxide([^a-z0-9]|$)' then 'oxide' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])taurate([^a-z0-9]|$)' then 'taurate' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])methylcobalamin([^a-z0-9]|$)' then 'methylcobalamin' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])cyanocobalamin([^a-z0-9]|$)' then 'cyanocobalamin' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])fish oil([^a-z0-9]|$)' then 'fish_oil' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])krill oil([^a-z0-9]|$)' then 'krill_oil' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])isolate([^a-z0-9]|$)' then 'isolate' end,
      case when lower(concat_ws(' ', p.title, fact_source.nutritional_facts::text)) ~ '(^|[^a-z0-9])(peptides|collagen peptides)([^a-z0-9]|$)' then 'peptides' end,
      case when lower(p.title) ~ '(^|[^a-z0-9])softgels?([^a-z0-9]|$)' then 'softgel' end,
      case when lower(p.title) ~ '(^|[^a-z0-9])tablets?([^a-z0-9]|$)' then 'tablet' end,
      case when lower(p.title) ~ '(^|[^a-z0-9])gummies?([^a-z0-9]|$)' then 'gummy' end,
      case when lower(p.title) ~ '(^|[^a-z0-9])chewables?([^a-z0-9]|$)' then 'chewable' end,
      case when lower(p.title) ~ '(^|[^a-z0-9])drops?([^a-z0-9]|$)' then 'drop' end,
      case when lower(p.title) ~ '(^|[^a-z0-9])liquid([^a-z0-9]|$)' then 'liquid' end,
      case when lower(p.title) ~ '(^|[^a-z0-9])fast[- ]?dissolv(e|ing)([^a-z0-9]|$)' then 'fast_dissolving' end,
      case when lower(p.title) ~ '(^|[^a-z0-9])powder([^a-z0-9]|$)' then 'powder' end
    ], null) as form_signals,
    coalesce(strengths.strength_values, '{}'::text[]) as strength_signals,
    case
      when facts.has_amount then 'full'
      when jsonb_array_length(fact_source.nutritional_facts) > 0 then 'partial'
      else 'none'
    end as facts_status,
    case when facts.has_amount then 'coverage_ready' else 'not_enough_structured_data' end as coverage_status,
    count(*) over (partition by lower(p.brand_name))::integer as brand_popularity,
    (
      case when facts.has_amount then 120 else 20 end
      + least(count(*) over (partition by lower(p.brand_name))::integer, 200)
    ) as quality_rank,
    p.updated_at as source_updated_at,
    now() as indexed_at
  from public.iherb_overlay_products p
  left join lateral (
    select case
      when jsonb_typeof(p.supplement_facts->'nutritionalFacts') = 'array' then p.supplement_facts->'nutritionalFacts'
      when jsonb_typeof(p.supplement_facts->'nutritional_facts') = 'array' then p.supplement_facts->'nutritional_facts'
      else '[]'::jsonb
    end as nutritional_facts
  ) fact_source on true
  left join lateral (
    select lower(
      regexp_replace(
        concat_ws(' ', p.title, fact_source.nutritional_facts::text, p.description_sections::text),
        '[^a-zA-Z0-9]+',
        ' ',
        'g'
      )
    ) as normalized_text
  ) search_source on true
  left join lateral (
    select
      bool_or(coalesce(item->>'amountPerServing', item->>'amount_per_serving', item->>'amount') ~* '[0-9]') as has_amount,
      nullif(
        (array_agg(coalesce(item->>'amountPerServing', item->>'amount_per_serving', item->>'amount')) filter (
          where coalesce(item->>'amountPerServing', item->>'amount_per_serving', item->>'amount') is not null
        ))[1],
        ''
      ) as first_amount
    from jsonb_array_elements(fact_source.nutritional_facts) item
    where not (
      coalesce(item->>'substancy', item->>'substance', item->>'substance_name', item->>'name', '') ~* '^\s*calories?\s*$'
      or coalesce(item->>'amountPerServing', item->>'amount_per_serving', item->>'amount', '') ~* '\b(kcal|calories?|cal)\b'
    )
  ) facts on true
  left join lateral (
    select array_agg(distinct lower((match.value)[1] || ' ' || case when (match.value)[2] = 'ui' then 'iu' else (match.value)[2] end)) as strength_values
    from regexp_matches(
      concat_ws(' ', p.title, fact_source.nutritional_facts::text),
      '([0-9][0-9,.]*)\s*(mg|mcg|g|iu|ui|ml|cfu)',
      'gi'
    ) as match(value)
  ) strengths on true
  where p.product_id is not null
    and p.brand_name is not null
    and p.title is not null
  on conflict (product_id) do update set
    overlay_id = excluded.overlay_id,
    brand_name = excluded.brand_name,
    title = excluded.title,
    upc_code = excluded.upc_code,
    barcode_gtin14 = excluded.barcode_gtin14,
    image_url = excluded.image_url,
    categories = excluded.categories,
    ingredients = excluded.ingredients,
    primary_facts_amount = excluded.primary_facts_amount,
    serving_size = excluded.serving_size,
    description = excluded.description,
    suggested_use = excluded.suggested_use,
    search_text = excluded.search_text,
    ingredient_families = excluded.ingredient_families,
    form_signals = excluded.form_signals,
    strength_signals = excluded.strength_signals,
    facts_status = excluded.facts_status,
    coverage_status = excluded.coverage_status,
    brand_popularity = excluded.brand_popularity,
    quality_rank = excluded.quality_rank,
    source_updated_at = excluded.source_updated_at,
    indexed_at = excluded.indexed_at
  returning 1
  ),
  deleted as (
    delete from public.product_search_index index_row
    where not exists (
      select 1
      from public.iherb_overlay_products source_row
      where source_row.product_id = index_row.product_id
    )
    returning 1
  )
  select upserted_count
  into refreshed_count
  from (select count(*)::integer as upserted_count from upserted) upserted_counts
  cross join (select count(*)::integer as deleted_count from deleted) deleted_counts;

  return refreshed_count;
end;
$$;

revoke all on function public.refresh_product_search_index() from public;
revoke all on function public.refresh_product_search_index() from anon, authenticated;
grant execute on function public.refresh_product_search_index() to service_role;

commit;
