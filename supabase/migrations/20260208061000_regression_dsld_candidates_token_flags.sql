-- Add token_hit_flags to the readonly DSLD candidate view to make CI scans faster and more stable.
--
-- Motivation:
-- - Candidate scan previously relied on per-token ILIKE queries which can hit statement timeouts.
-- - Exposing precomputed flags allows the scan to fetch a single sample and stratify locally,
--   reducing DB round-trips and improving determinism.
--
-- Notes:
-- - The view remains the only anon/authenticated-exposed object; base table access stays revoked.
-- - We keep the view surface area limited to metadata + active_ingredients_summary + token flags.

-- Important: CREATE OR REPLACE VIEW cannot change existing view column names/order.
-- We drop the view first to allow schema evolution without manual intervention.
drop view if exists public.regression_dsld_form_candidates_v;

-- Improve ILIKE performance for any remaining token filters (optional, but high ROI).
create extension if not exists pg_trgm;
create index if not exists dsld_labels_meta_active_ingredients_summary_trgm_idx
  on public.dsld_labels_meta
  using gin (active_ingredients_summary gin_trgm_ops);

create or replace view public.regression_dsld_form_candidates_v as
select
  m.barcode_normalized_gtin14,
  m.dsld_label_id,
  m.dsld_product_version_code,
  m.brand,
  m.product_name,
  m.serving_size_raw,
  m.servings_per_container,
  m.active_ingredients_summary,
  jsonb_build_object(
    -- Core salt/form tokens (high ROI / high frequency).
    'oxide', position('oxide' in lower(coalesce(m.active_ingredients_summary, ''))) > 0,
    'citrate', position('citrate' in lower(coalesce(m.active_ingredients_summary, ''))) > 0,
    'glycinate', position('glycinate' in lower(coalesce(m.active_ingredients_summary, ''))) > 0,
    'bisglycinate', position('bisglycinate' in lower(coalesce(m.active_ingredients_summary, ''))) > 0,
    'ascorbate', position('ascorbate' in lower(coalesce(m.active_ingredients_summary, ''))) > 0,
    'picolinate', position('picolinate' in lower(coalesce(m.active_ingredients_summary, ''))) > 0,
    'sulfate', position('sulfate' in lower(coalesce(m.active_ingredients_summary, ''))) > 0,
    'chloride', position('chloride' in lower(coalesce(m.active_ingredients_summary, ''))) > 0,
    'hydrochloride', position('hydrochloride' in lower(coalesce(m.active_ingredients_summary, ''))) > 0,
    'hcl', position(' hcl' in lower(coalesce(m.active_ingredients_summary, ''))) > 0,
    'mononitrate', position('mononitrate' in lower(coalesce(m.active_ingredients_summary, ''))) > 0,
    'phosphate', position('phosphate' in lower(coalesce(m.active_ingredients_summary, ''))) > 0,
    'acetate', position('acetate' in lower(coalesce(m.active_ingredients_summary, ''))) > 0,
    'monohydrate', position('monohydrate' in lower(coalesce(m.active_ingredients_summary, ''))) > 0
  ) as token_hit_flags
from public.dsld_labels_meta m
where m.barcode_normalized_gtin14 is not null;

-- Harden access: expose only the view to anon/authenticated, and remove direct access to the base table.
revoke all on table public.dsld_labels_meta from anon, authenticated;
grant select on public.regression_dsld_form_candidates_v to anon, authenticated;
