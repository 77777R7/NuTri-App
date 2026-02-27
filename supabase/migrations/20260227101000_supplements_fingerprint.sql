-- 20260227101000_supplements_fingerprint.sql
-- Ensure ensure-overview can resolve/insert supplements by deterministic fingerprint.

begin;

alter table if exists public.supplements
  add column if not exists fingerprint text;

create unique index if not exists supplements_fingerprint_unique_idx
  on public.supplements (fingerprint)
  where fingerprint is not null;

commit;
