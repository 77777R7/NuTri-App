-- Expand user_profiles to the full onboarding/personalization shape expected by
-- the current profile sync path and backend decision support.

alter table public.user_profiles
  add column if not exists age_range text,
  add column if not exists sex text,
  add column if not exists supplement_experience text,
  add column if not exists dietary_preferences text[],
  add column if not exists preferred_types text[],
  add column if not exists adherence_blocker text,
  add column if not exists permission_preferences jsonb,
  add column if not exists smart_filter_config jsonb,
  add column if not exists onboarding_version text,
  add column if not exists onboarding_completed_at timestamp with time zone,
  add column if not exists first_action_preference text,
  add column if not exists location_country text,
  add column if not exists location_city text,
  add column if not exists health_goals text[],
  add column if not exists onboarding_completed boolean default false,
  add column if not exists trial_status text,
  add column if not exists trial_started_at timestamp with time zone;

comment on column public.user_profiles.age_range is
  'Expanded onboarding profile: canonical age range answer.';
comment on column public.user_profiles.sex is
  'Expanded onboarding profile: normalized sex answer for personalization.';
comment on column public.user_profiles.supplement_experience is
  'Expanded onboarding profile: supplement experience level from onboarding v2.';
comment on column public.user_profiles.dietary_preferences is
  'Expanded onboarding profile: declared diets/preferences used by personalization.';
comment on column public.user_profiles.preferred_types is
  'Expanded onboarding profile: preferred supplement types used by personalization.';
comment on column public.user_profiles.adherence_blocker is
  'Expanded onboarding profile: declared blocker that shapes support strategy.';
comment on column public.user_profiles.permission_preferences is
  'Expanded onboarding profile: setup/permission preferences snapshot.';
comment on column public.user_profiles.smart_filter_config is
  'Expanded onboarding profile: smart filter state derived from onboarding answers.';
comment on column public.user_profiles.onboarding_version is
  'Expanded onboarding profile: onboarding contract version that produced this row.';
comment on column public.user_profiles.onboarding_completed_at is
  'Expanded onboarding profile: completion timestamp for onboarding.';
comment on column public.user_profiles.first_action_preference is
  'Expanded onboarding profile: preferred first action after onboarding.';
comment on column public.user_profiles.location_country is
  'Expanded onboarding profile: normalized country value.';
comment on column public.user_profiles.location_city is
  'Expanded onboarding profile: normalized city value.';
comment on column public.user_profiles.health_goals is
  'Expanded onboarding profile: declared health goals in onboarding order.';
comment on column public.user_profiles.onboarding_completed is
  'Expanded onboarding profile: whether onboarding was completed.';
comment on column public.user_profiles.trial_status is
  'Expanded onboarding profile: trial lifecycle state.';
comment on column public.user_profiles.trial_started_at is
  'Expanded onboarding profile: trial start timestamp.';
