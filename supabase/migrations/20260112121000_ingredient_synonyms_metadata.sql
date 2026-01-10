-- 20260112121000_ingredient_synonyms_metadata.sql
-- Add metadata columns for synonym resolution.

begin;

alter table if exists public.ingredient_synonyms
  add column if not exists alias_type text,
  add column if not exists confidence numeric(5,4);

alter table if exists public.ingredient_synonyms
  add constraint ingredient_synonyms_confidence_check
  check (confidence is null or (confidence >= 0 and confidence <= 1));

commit;
