-- Read-only DSLD candidate view for CI scanning (minimal surface area).
--
-- Goal: allow GitHub Actions to discover stable DSLD regression candidates using an anon/readonly key,
-- without granting access to underlying DSLD metadata/facts tables or exposing unnecessary product fields.
--
-- Exposed fields are intentionally limited to what's needed for candidate selection and reproducibility:
-- - barcode_normalized_gtin14
-- - dsld_label_id
-- - dsld_product_version_code (facts/version signal)
-- - active_ingredients_summary (evidence snippet for token + "(as ...)" parsing)

-- Postgres cannot "create or replace" a view while dropping columns. Drop first.
drop view if exists public.regression_dsld_form_candidates_v;

create view public.regression_dsld_form_candidates_v as
select
  m.barcode_normalized_gtin14,
  m.dsld_label_id,
  m.dsld_product_version_code,
  m.active_ingredients_summary
from public.dsld_labels_meta m
where m.barcode_normalized_gtin14 is not null;

-- Harden access: expose only the view to anon/authenticated, and remove direct access to the base table.
revoke all on table public.dsld_labels_meta from anon, authenticated;
grant select on public.regression_dsld_form_candidates_v to anon, authenticated;
