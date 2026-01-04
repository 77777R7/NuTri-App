-- Supabase storage buckets required by the NuTri application.

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

  if not (has_sig2 or has_sig3 or has_sig5) then
    raise notice 'storage.create_bucket not found; skipping bucket creation';
    return;
  end if;

  if not exists (select 1 from storage.buckets where id = 'supplement-images') then
    if has_sig5 then
      execute format(
        'select storage.create_bucket(%L, %L, %L, null, null)',
        'supplement-images',
        'supplement-images',
        true
      );
    elsif has_sig3 then
      execute format(
        'select storage.create_bucket(%L, %L, %L)',
        'supplement-images',
        'supplement-images',
        true
      );
    else
      execute format(
        'select storage.create_bucket(%L, %L)',
        'supplement-images',
        true
      );
    end if;
  end if;

  if not exists (select 1 from storage.buckets where id = 'user-profile-photos') then
    if has_sig5 then
      execute format(
        'select storage.create_bucket(%L, %L, %L, null, null)',
        'user-profile-photos',
        'user-profile-photos',
        false
      );
    elsif has_sig3 then
      execute format(
        'select storage.create_bucket(%L, %L, %L)',
        'user-profile-photos',
        'user-profile-photos',
        false
      );
    else
      execute format(
        'select storage.create_bucket(%L, %L)',
        'user-profile-photos',
        false
      );
    end if;
  end if;

  if not exists (select 1 from storage.buckets where id = 'scan-history') then
    if has_sig5 then
      execute format(
        'select storage.create_bucket(%L, %L, %L, null, null)',
        'scan-history',
        'scan-history',
        false
      );
    elsif has_sig3 then
      execute format(
        'select storage.create_bucket(%L, %L, %L)',
        'scan-history',
        'scan-history',
        false
      );
    else
      execute format(
        'select storage.create_bucket(%L, %L)',
        'scan-history',
        false
      );
    end if;
  end if;
end;
$$;
