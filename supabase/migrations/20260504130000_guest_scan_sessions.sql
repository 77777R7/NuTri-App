-- Guest scan sessions hold the one-free-scan boundary for signed-out users.

begin;

create table if not exists public.guest_scan_sessions (
  id uuid primary key default gen_random_uuid(),
  claim_token_hash text not null unique,
  status text not null default 'created',
  scan_session_id text,
  barcode text,
  barcode_gtin14 text,
  product_name text,
  brand_name text,
  product_image_url text,
  result_identity_type text,
  result_identity_value text,
  result_snapshot_id text,
  result_meta jsonb,
  claimed_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_scan_sessions_status_chk check (
    status in (
      'created',
      'scanning',
      'result_started',
      'result_ready',
      'claim_pending',
      'claimed',
      'claim_failed',
      'expired'
    )
  )
);

create index if not exists guest_scan_sessions_expires_at_idx
  on public.guest_scan_sessions (expires_at);

create index if not exists guest_scan_sessions_claimed_user_idx
  on public.guest_scan_sessions (claimed_user_id)
  where claimed_user_id is not null;

alter table if exists public.guest_scan_sessions enable row level security;
revoke all on table public.guest_scan_sessions from anon, authenticated;
grant all on table public.guest_scan_sessions to service_role;

comment on table public.guest_scan_sessions is
  'Short-lived signed-out scan sessions. Raw claim tokens are never stored.';

comment on column public.guest_scan_sessions.claim_token_hash is
  'SHA-256 hash of the local-only claim token returned once to the mobile client.';

commit;
