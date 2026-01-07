-- 20260111122000_scoring_dataset_state.sql
-- Track dataset versions used in scoring inputs.

begin;

create table if not exists public.scoring_dataset_state (
  key text primary key,
  version text,
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger scoring_dataset_state_set_updated_at
before update on public.scoring_dataset_state
for each row execute function public.set_current_timestamp_updated_at();

commit;
