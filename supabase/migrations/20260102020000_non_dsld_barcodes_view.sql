-- 20260102020000_non_dsld_barcodes_view.sql
-- Track barcodes missing from DSLD but resolved via Google or cache.

begin;

create or replace view public.non_dsld_barcodes as
with agg as (
  select
    barcode_gtin14,
    count(*) as scan_count,
    min(created_at) as first_seen_at,
    max(created_at) as last_seen_at
  from public.barcode_scans
  where catalog_hit = false
    and served_from in ('google_ai', 'snapshot_cache', 'wait_inflight')
  group by barcode_gtin14
),
catalog_hits as (
  select distinct barcode_gtin14
  from public.barcode_scans
  where catalog_hit = true
)
select
  agg.barcode_gtin14,
  agg.scan_count,
  agg.first_seen_at,
  agg.last_seen_at,
  (s.payload_json -> 'product'::text) ->> 'brand'::text as guessed_brand,
  (s.payload_json -> 'product'::text) ->> 'name'::text as guessed_name,
  (s.payload_json -> 'product'::text) ->> 'category'::text as guessed_category,
  (s.payload_json -> 'product'::text) ->> 'form'::text as product_form,
  (s.payload_json -> 'product'::text) ->> 'imageUrl'::text as guessed_image_url,
  (s.payload_json ->> 'status'::text) as snapshot_status,
  s.id as snapshot_id,
  s.updated_at as snapshot_updated_at,
  s.created_at as snapshot_created_at
from agg
left join lateral (
  select snapshots.id, snapshots.created_at, snapshots.updated_at, snapshots.payload_json
  from public.snapshots
  where snapshots.source = 'barcode'::text
    and snapshots.key = agg.barcode_gtin14
  order by snapshots.updated_at desc, snapshots.created_at desc
  limit 1
) s on true
left join catalog_hits ch on ch.barcode_gtin14 = agg.barcode_gtin14
where ch.barcode_gtin14 is null
order by agg.scan_count desc;

commit;
