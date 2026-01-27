-- 20260123123000_product_scores_shadow.sql
-- Shadow scores table for Phase D regression without touching production scores.

begin;

create table if not exists public.product_scores_shadow (
  like public.product_scores including defaults
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_scores_shadow_source_source_id_key'
  ) then
    alter table public.product_scores_shadow
      add constraint product_scores_shadow_source_source_id_key
      unique (source, source_id);
  end if;
end $$;

create index if not exists product_scores_shadow_canonical_source_idx
  on public.product_scores_shadow (canonical_source_id);

create index if not exists product_scores_shadow_computed_at_idx
  on public.product_scores_shadow (computed_at);

create trigger product_scores_shadow_set_updated_at
before update on public.product_scores_shadow
for each row execute function public.set_current_timestamp_updated_at();

commit;
