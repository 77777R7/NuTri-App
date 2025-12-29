-- 20251228110000_snapshots.sql
-- Snapshot cache table for supplement analysis results.

begin;

create table if not exists public.snapshots (
  id text primary key,
  key text not null,
  source text not null,
  payload_json jsonb not null,
  analysis_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists snapshots_key_idx
  on public.snapshots (key);

create index if not exists snapshots_expires_at_idx
  on public.snapshots (expires_at);

-- RLS: backend-owned cache table
alter table public.snapshots enable row level security;

revoke all on table public.snapshots from anon, authenticated;
grant all on table public.snapshots to service_role;

drop policy if exists "service role full access" on public.snapshots;
create policy "service role full access"
on public.snapshots
for all
to service_role
using (true)
with check (true);

commit;
