-- DB-side acceleration for the existing Product Search cold bootstrap/search
-- paths. This intentionally avoids adding a new RPC or home table because the
-- current runtime code reads product_search_index directly.

create extension if not exists pg_trgm;

create index if not exists product_search_index_brand_quality_idx
  on public.product_search_index (
    brand_name,
    quality_rank desc,
    brand_popularity desc,
    source_updated_at desc
  );

create index if not exists product_search_index_brand_name_trgm_idx
  on public.product_search_index using gin (brand_name gin_trgm_ops);

create index if not exists product_search_index_upc_trgm_idx
  on public.product_search_index using gin (upc_code gin_trgm_ops)
  where upc_code is not null;

create index if not exists product_search_index_gtin14_trgm_idx
  on public.product_search_index using gin (barcode_gtin14 gin_trgm_ops)
  where barcode_gtin14 is not null;
