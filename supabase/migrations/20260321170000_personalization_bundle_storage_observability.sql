do $$
declare
  has_sig2 boolean;
  has_sig3 boolean;
  has_sig5 boolean;
begin
  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'storage'
      and p.proname = 'create_bucket'
      and p.pronargs = 2
  ) into has_sig2;

  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'storage'
      and p.proname = 'create_bucket'
      and p.pronargs = 3
  ) into has_sig3;

  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'storage'
      and p.proname = 'create_bucket'
      and p.pronargs >= 5
  ) into has_sig5;

  if has_sig2 or has_sig3 or has_sig5 then
    if not exists (select 1 from storage.buckets where id = 'personalization-artifacts') then
      if has_sig5 then
        execute format(
          'select storage.create_bucket(%L, %L, %L, null, null)',
          'personalization-artifacts',
          'personalization-artifacts',
          false
        );
      elsif has_sig3 then
        execute format(
          'select storage.create_bucket(%L, %L, %L)',
          'personalization-artifacts',
          'personalization-artifacts',
          false
        );
      else
        execute format(
          'select storage.create_bucket(%L, %L)',
          'personalization-artifacts',
          false
        );
      end if;
    end if;
  else
    raise notice 'storage.create_bucket not found; skipping personalization-artifacts bucket creation';
  end if;
end;
$$;

alter table public.personalization_bundle_runs
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists artifact_byte_size integer,
  add column if not exists artifact_checksum text,
  add column if not exists is_active boolean not null default false,
  add column if not exists activated_at timestamptz;

create index if not exists personalization_bundle_runs_kind_active_generated_idx
  on public.personalization_bundle_runs (artifact_kind, is_active, generated_at desc);

create unique index if not exists personalization_bundle_runs_one_active_per_kind_idx
  on public.personalization_bundle_runs (artifact_kind)
  where is_active = true;
