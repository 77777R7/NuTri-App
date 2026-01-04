-- 20260106123000_fact_columns.sql
-- Add brand/product columns to facts tables and update LNHPD refresh to populate them.

begin;

alter table if exists public.dsld_label_facts
  add column if not exists brand_name text,
  add column if not exists product_name text;

alter table if exists public.lnhpd_facts
  add column if not exists brand_name text,
  add column if not exists product_name text,
  add column if not exists npn text,
  add column if not exists is_on_market boolean;

create index if not exists dsld_label_facts_brand_name_idx
  on public.dsld_label_facts (brand_name);

create index if not exists dsld_label_facts_product_name_idx
  on public.dsld_label_facts (product_name);

create index if not exists lnhpd_facts_brand_name_idx
  on public.lnhpd_facts (brand_name);

create index if not exists lnhpd_facts_product_name_idx
  on public.lnhpd_facts (product_name);

create index if not exists lnhpd_facts_npn_idx
  on public.lnhpd_facts (npn);

update public.dsld_label_facts
set
  brand_name = coalesce(brand_name, facts_json->>'brandName'),
  product_name = coalesce(product_name, facts_json->>'productName')
where brand_name is null or product_name is null;

update public.lnhpd_facts
set
  brand_name = coalesce(brand_name, facts_json->>'brandName'),
  product_name = coalesce(product_name, facts_json->>'productName'),
  npn = coalesce(npn, facts_json->>'npn'),
  is_on_market = coalesce(
    is_on_market,
    case lower(facts_json->>'isOnMarket')
      when 'true' then true
      when 'false' then false
      else null
    end
  )
where brand_name is null
  or product_name is null
  or npn is null
  or is_on_market is null;

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
  )
  insert into public.lnhpd_facts (
    lnhpd_id,
    facts_json,
    dataset_version,
    extracted_at,
    brand_name,
    product_name,
    npn,
    is_on_market
  )
  select
    lnhpd_id,
    jsonb_build_object(
      'brandName', coalesce(
        max(company_name) filter (where endpoint = 'ProductLicence' and flag_primary_name = 1),
        max(company_name) filter (where endpoint = 'ProductLicence')
      ),
      'productName', coalesce(
        max(product_name) filter (where endpoint = 'ProductLicence' and flag_primary_name = 1),
        max(product_name) filter (where endpoint = 'ProductLicence')
      ),
      'npn', coalesce(
        max(licence_number) filter (where endpoint = 'ProductLicence' and flag_primary_name = 1),
        max(licence_number) filter (where endpoint = 'ProductLicence')
      ),
      'isOnMarket', coalesce(
        bool_or(flag_product_status = 1) filter (where endpoint = 'ProductLicence'),
        false
      ),
      'productLicences', coalesce(jsonb_agg(payload) filter (where endpoint = 'ProductLicence'), '[]'::jsonb),
      'medicinalIngredients', coalesce(jsonb_agg(payload) filter (where endpoint = 'MedicinalIngredient'), '[]'::jsonb),
      'nonMedicinalIngredients', coalesce(jsonb_agg(payload) filter (where endpoint = 'NonMedicinalIngredient'), '[]'::jsonb),
      'doses', coalesce(jsonb_agg(payload) filter (where endpoint = 'ProductDose'), '[]'::jsonb),
      'purposes', coalesce(jsonb_agg(payload) filter (where endpoint = 'ProductPurpose'), '[]'::jsonb),
      'routes', coalesce(jsonb_agg(payload) filter (where endpoint = 'ProductRoute'), '[]'::jsonb)
    ) as facts_json,
    max(dataset_version) as dataset_version,
    timezone('utc', now()) as extracted_at,
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
    ) as is_on_market
  from base
  group by lnhpd_id
  having coalesce(
    bool_or(flag_product_status = 1) filter (where endpoint = 'ProductLicence'),
    false
  )
  on conflict (lnhpd_id) do update
    set facts_json = excluded.facts_json,
        dataset_version = excluded.dataset_version,
        extracted_at = excluded.extracted_at,
        brand_name = excluded.brand_name,
        product_name = excluded.product_name,
        npn = excluded.npn,
        is_on_market = excluded.is_on_market;
$$;

commit;
