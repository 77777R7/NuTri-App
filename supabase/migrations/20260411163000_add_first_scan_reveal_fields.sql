alter table public.user_profiles
  add column if not exists first_completed_scan_id text,
  add column if not exists first_scan_reveal_state text,
  add column if not exists first_scan_reveal_scan_id text,
  add column if not exists first_scan_reveal_granted_at timestamp with time zone,
  add column if not exists first_scan_paywall_seen_at timestamp with time zone;

comment on column public.user_profiles.first_completed_scan_id is
  'Canonical first completed scan id for first-scan reveal gating.';

comment on column public.user_profiles.first_scan_reveal_state is
  'State machine for first scan reveal: eligible, granted, paywall_seen, converted.';

comment on column public.user_profiles.first_scan_reveal_scan_id is
  'Scan id currently associated with the one-time first scan reveal.';

comment on column public.user_profiles.first_scan_reveal_granted_at is
  'Timestamp when the first scan reveal entered granted state.';

comment on column public.user_profiles.first_scan_paywall_seen_at is
  'Timestamp when the first scan reveal paywall impression was recorded.';
