-- Read-only DSLD candidate view for CI scanning.
--
-- Goal: allow GitHub Actions to discover stable DSLD regression candidates using an anon/readonly key,
-- without granting access to underlying DSLD metadata/facts tables.
--
-- This is intentionally a small surface area: barcode + label id + human triage fields.

create or replace view public.regression_dsld_form_candidates_v as
select
  m.barcode_normalized_gtin14,
  m.dsld_label_id,
  m.dsld_product_version_code,
  m.brand,
  m.product_name,
  m.serving_size_raw,
  m.servings_per_container,
  m.active_ingredients_summary
from public.dsld_labels_meta m
where m.barcode_normalized_gtin14 is not null;

-- Harden access: expose only the view to anon/authenticated, and remove direct access to the base table.
revoke all on table public.dsld_labels_meta from anon, authenticated;
grant select on public.regression_dsld_form_candidates_v to anon, authenticated;

