-- 20260106122000_lnhpd_facts.sql
-- Structured LNHPD facts table derived from lnhpd_raw_records.

begin;

create table if not exists public.lnhpd_facts (
  lnhpd_id bigint primary key,
  facts_json jsonb not null,
  dataset_version text,
  extracted_at timestamptz not null default timezone('utc', now())
);

create index if not exists lnhpd_facts_lnhpd_id_idx
  on public.lnhpd_facts (lnhpd_id);

create or replace function public.resolve_lnhpd_facts_by_id(p_lnhpd_id bigint)
returns table (
  lnhpd_id bigint,
  facts_json jsonb,
  dataset_version text,
  extracted_at timestamptz
)
language sql
stable
as $$
  select f.lnhpd_id, f.facts_json, f.dataset_version, f.extracted_at
  from public.lnhpd_facts f
  where f.lnhpd_id = p_lnhpd_id
  limit 1;
$$;

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
  insert into public.lnhpd_facts (lnhpd_id, facts_json, dataset_version, extracted_at)
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
    timezone('utc', now()) as extracted_at
  from base
  group by lnhpd_id
  having coalesce(
    bool_or(flag_product_status = 1) filter (where endpoint = 'ProductLicence'),
    false
  )
  on conflict (lnhpd_id) do update
    set facts_json = excluded.facts_json,
        dataset_version = excluded.dataset_version,
        extracted_at = excluded.extracted_at;
$$;

commit;
