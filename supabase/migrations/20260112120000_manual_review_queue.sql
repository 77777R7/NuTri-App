-- 20260112120000_manual_review_queue.sql
-- Manual review queue for unresolved ingredient synonyms.

begin;

create table if not exists public.manual_review_queue (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  source text,
  name_key text,
  name_raw text,
  payload_json jsonb,
  status text not null default 'open',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists manual_review_queue_status_idx
  on public.manual_review_queue (status);

create index if not exists manual_review_queue_entity_idx
  on public.manual_review_queue (entity_type);

create trigger manual_review_queue_set_updated_at
before update on public.manual_review_queue
for each row execute function public.set_current_timestamp_updated_at();

commit;
