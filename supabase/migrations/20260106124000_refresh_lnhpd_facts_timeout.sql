-- 20260106124000_refresh_lnhpd_facts_timeout.sql
-- Allow LNHPD refresh to run without statement timeout.

begin;

create or replace function public.refresh_lnhpd_facts()
returns void
language plpgsql
as $$
begin
  perform set_config('statement_timeout', '0', true);

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
  from (
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
  ) base
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
end;
$$;

commit;
