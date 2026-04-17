alter table public.user_profiles
  add column if not exists premium_status text,
  add column if not exists premium_entitlement text,
  add column if not exists premium_source text,
  add column if not exists premium_customer_id text,
  add column if not exists premium_product_id text,
  add column if not exists premium_store text,
  add column if not exists premium_expires_at timestamp with time zone,
  add column if not exists premium_will_renew boolean,
  add column if not exists premium_period_type text,
  add column if not exists premium_updated_at timestamp with time zone;

comment on column public.user_profiles.premium_status is
  'Latest normalized subscription entitlement status for Premium access.';

comment on column public.user_profiles.premium_entitlement is
  'RevenueCat entitlement identifier that currently drives Premium access.';

comment on column public.user_profiles.premium_source is
  'Source of truth for the latest Premium entitlement sync, typically revenuecat.';

comment on column public.user_profiles.premium_customer_id is
  'RevenueCat app user identifier observed during the latest entitlement sync.';

comment on column public.user_profiles.premium_product_id is
  'Store product identifier that most recently unlocked Premium.';

comment on column public.user_profiles.premium_store is
  'Store origin for the latest Premium entitlement, such as APP_STORE or PLAY_STORE.';

comment on column public.user_profiles.premium_expires_at is
  'Entitlement expiration timestamp when Premium access is time-bounded.';

comment on column public.user_profiles.premium_will_renew is
  'Whether the latest Premium entitlement is expected to auto-renew.';

comment on column public.user_profiles.premium_period_type is
  'RevenueCat period type for the latest entitlement, such as trial or normal.';

comment on column public.user_profiles.premium_updated_at is
  'Timestamp of the latest Premium entitlement sync into user_profiles.';
