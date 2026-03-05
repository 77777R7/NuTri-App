-- iHerb overlay pilot tables (Demo5)
-- Overlay-only evidence store. Does NOT mutate authoritative DSLD/LNHPD tables.

create table if not exists public.iherb_overlay_products (
  id bigserial primary key,
  product_id text not null,
  brand_name text not null,
  title text not null,
  upc_code text,
  barcode_gtin14 text,
  link text,
  product_images jsonb not null default '[]'::jsonb,
  product_catalog_image text,
  categories jsonb not null default '[]'::jsonb,
  serving jsonb not null default '{}'::jsonb,
  supplement_facts jsonb not null default '{}'::jsonb,
  description_sections jsonb not null default '{}'::jsonb,
  source_zip_path text,
  source_extracted_at timestamptz,
  overlay_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint iherb_overlay_products_product_id_uniq unique (product_id),
  constraint iherb_overlay_products_gtin14_format_chk
    check (barcode_gtin14 is null or barcode_gtin14 ~ '^[0-9]{14}$')
);

create index if not exists iherb_overlay_products_gtin14_idx
  on public.iherb_overlay_products (barcode_gtin14);

create index if not exists iherb_overlay_products_brand_idx
  on public.iherb_overlay_products (brand_name);

alter table public.iherb_overlay_products enable row level security;
revoke all on table public.iherb_overlay_products from anon, authenticated;
grant all on table public.iherb_overlay_products to service_role;

drop policy if exists "service role full access" on public.iherb_overlay_products;
create policy "service role full access"
on public.iherb_overlay_products
for all
to service_role
using (true)
with check (true);

create table if not exists public.iherb_overlay_merge_audit (
  id bigserial primary key,
  run_id text not null,
  product_id text not null,
  barcode_gtin14 text,
  authoritative_source_type text,
  authoritative_identity_key text,
  match_status text not null,
  reason_code text,
  merge_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint iherb_overlay_merge_audit_gtin14_format_chk
    check (barcode_gtin14 is null or barcode_gtin14 ~ '^[0-9]{14}$')
);

create index if not exists iherb_overlay_merge_audit_run_idx
  on public.iherb_overlay_merge_audit (run_id, created_at desc);

create index if not exists iherb_overlay_merge_audit_status_idx
  on public.iherb_overlay_merge_audit (match_status, reason_code);

create index if not exists iherb_overlay_merge_audit_gtin14_idx
  on public.iherb_overlay_merge_audit (barcode_gtin14);

alter table public.iherb_overlay_merge_audit enable row level security;
revoke all on table public.iherb_overlay_merge_audit from anon, authenticated;
grant all on table public.iherb_overlay_merge_audit to service_role;

drop policy if exists "service role full access" on public.iherb_overlay_merge_audit;
create policy "service role full access"
on public.iherb_overlay_merge_audit
for all
to service_role
using (true)
with check (true);
