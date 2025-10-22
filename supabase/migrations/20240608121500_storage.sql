-- Supabase storage buckets required by the NuTri application.

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'supplement-images') then
    perform storage.create_bucket('supplement-images', public => true);
  end if;

  if not exists (select 1 from storage.buckets where id = 'user-profile-photos') then
    perform storage.create_bucket('user-profile-photos', public => false);
  end if;

  if not exists (select 1 from storage.buckets where id = 'scan-history') then
    perform storage.create_bucket('scan-history', public => false);
  end if;
end;
$$;
