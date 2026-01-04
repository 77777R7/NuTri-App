-- 20260107121000_lnhpd_completeness.sql
-- Track LNHPD completeness and expose complete-only view.

begin;

alter table if exists public.lnhpd_facts
  add column if not exists is_complete boolean,
  add column if not exists missing_fields text[];

update public.lnhpd_facts
set
  missing_fields = array_remove(array[
    case when jsonb_array_length(coalesce(facts_json->'medicinalIngredients', '[]'::jsonb)) = 0 then 'medicinal' end,
    case when jsonb_array_length(coalesce(facts_json->'nonMedicinalIngredients', '[]'::jsonb)) = 0 then 'nonmedicinal' end,
    case when jsonb_array_length(coalesce(facts_json->'purposes', '[]'::jsonb)) = 0 then 'purpose' end
  ]::text[], null::text),
  is_complete = (
    jsonb_array_length(coalesce(facts_json->'medicinalIngredients', '[]'::jsonb)) > 0
    and jsonb_array_length(coalesce(facts_json->'nonMedicinalIngredients', '[]'::jsonb)) > 0
    and jsonb_array_length(coalesce(facts_json->'purposes', '[]'::jsonb)) > 0
  )
where is_complete is null
  or missing_fields is null;

create or replace view public.lnhpd_facts_complete as
select *
from public.lnhpd_facts
where is_complete = true
  and coalesce(is_on_market, true) = true;

create or replace function public.refresh_lnhpd_facts()
returns void
language sql
as $$
  with base as (
    select
      lnhpd_id,
      endpoint,
      payload,
      dataset_version,
      case
        when (payload->>'flag_primary_name') ~ '^[0-9]+$'
          then (payload->>'flag_primary_name')::int
        else null
      end as flag_primary_name,
      case
        when (payload->>'flag_product_status') ~ '^[0-9]+$'
          then (payload->>'flag_product_status')::int
        else null
      end as flag_product_status,
      payload->>'company_name' as company_name,
      payload->>'product_name' as product_name,
      payload->>'licence_number' as licence_number
    from public.lnhpd_raw_records
    where lnhpd_id is not null
  ),
  agg as (
    select
      lnhpd_id,
      max(dataset_version) as dataset_version,
      coalesce(
        max(company_name) filter (where endpoint = 'ProductLicence' and flag_primary_name = 1),
        max(company_name) filter (where endpoint = 'ProductLicence')
      ) as brand_name,
      coalesce(
        max(product_name) filter (where endpoint = 'ProductLicence' and flag_primary_name = 1),
        max(product_name) filter (where endpoint = 'ProductLicence')
      ) as product_name,
      coalesce(
        max(licence_number) filter (where endpoint = 'ProductLicence' and flag_primary_name = 1),
        max(licence_number) filter (where endpoint = 'ProductLicence')
      ) as npn,
      coalesce(
        bool_or(flag_product_status = 1) filter (where endpoint = 'ProductLicence'),
        false
      ) as is_on_market,
      coalesce(jsonb_agg(payload) filter (where endpoint = 'ProductLicence'), '[]'::jsonb) as product_licences,
      coalesce(jsonb_agg(payload) filter (where endpoint = 'MedicinalIngredient'), '[]'::jsonb) as medicinal_ingredients,
      coalesce(jsonb_agg(payload) filter (where endpoint = 'NonMedicinalIngredient'), '[]'::jsonb) as nonmedicinal_ingredients,
      coalesce(jsonb_agg(payload) filter (where endpoint = 'ProductDose'), '[]'::jsonb) as doses,
      coalesce(jsonb_agg(payload) filter (where endpoint = 'ProductPurpose'), '[]'::jsonb) as purposes,
      coalesce(jsonb_agg(payload) filter (where endpoint = 'ProductRoute'), '[]'::jsonb) as routes,
      count(*) filter (where endpoint = 'MedicinalIngredient') as medicinal_count,
      count(*) filter (where endpoint = 'NonMedicinalIngredient') as nonmedicinal_count,
      count(*) filter (where endpoint = 'ProductPurpose') as purpose_count
    from base
    group by lnhpd_id
  )
  insert into public.lnhpd_facts (
    lnhpd_id,
    facts_json,
    dataset_version,
    extracted_at,
    brand_name,
    product_name,
    npn,
    is_on_market,
    is_complete,
    missing_fields
  )
  select
    lnhpd_id,
    jsonb_build_object(
      'brandName', brand_name,
      'productName', product_name,
      'npn', npn,
      'isOnMarket', is_on_market,
      'productLicences', product_licences,
      'medicinalIngredients', medicinal_ingredients,
      'nonMedicinalIngredients', nonmedicinal_ingredients,
      'doses', doses,
      'purposes', purposes,
      'routes', routes
    ) as facts_json,
    dataset_version,
    timezone('utc', now()) as extracted_at,
    brand_name,
    product_name,
    npn,
    is_on_market,
    (medicinal_count > 0 and nonmedicinal_count > 0 and purpose_count > 0) as is_complete,
    array_remove(array[
      case when medicinal_count = 0 then 'medicinal' end,
      case when nonmedicinal_count = 0 then 'nonmedicinal' end,
      case when purpose_count = 0 then 'purpose' end
    ]::text[], null::text) as missing_fields
  from agg
  where is_on_market = true
  on conflict (lnhpd_id) do update
    set facts_json = excluded.facts_json,
        dataset_version = excluded.dataset_version,
        extracted_at = excluded.extracted_at,
        brand_name = excluded.brand_name,
        product_name = excluded.product_name,
        npn = excluded.npn,
        is_on_market = excluded.is_on_market,
        is_complete = excluded.is_complete,
        missing_fields = excluded.missing_fields;
$$;

commit;
