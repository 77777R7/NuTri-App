-- Remove legacy anthropometric columns that are no longer used by the app.
-- Apply only after clients stop sending height/weight in user_profiles payloads.

alter table public.user_profiles
  drop column if exists height,
  drop column if exists weight;
