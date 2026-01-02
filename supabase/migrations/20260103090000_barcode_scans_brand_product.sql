-- 20260103090000_barcode_scans_brand_product.sql
-- Add brand/product columns to barcode scan logs.

begin;

alter table if exists public.barcode_scans
  add column if not exists brand_name text,
  add column if not exists product_name text;

commit;
