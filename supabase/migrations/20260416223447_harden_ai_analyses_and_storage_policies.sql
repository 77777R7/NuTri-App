-- Harden public analysis writes and make Storage bucket access reproducible in migrations.

drop policy if exists ai_analyses_insert_authenticated on public.ai_analyses;

create policy ai_analyses_insert_authenticated on public.ai_analyses
  for insert
  with check (
    auth.uid() = user_id
    or auth.role() = 'service_role'
  );

alter table storage.objects enable row level security;

update storage.buckets
set public = true
where id = 'supplement-images';

update storage.buckets
set public = false
where id in ('user-profile-photos', 'scan-history', 'personalization-artifacts');

drop policy if exists supplement_images_public_read on storage.objects;
create policy supplement_images_public_read on storage.objects
  for select
  to public
  using (bucket_id = 'supplement-images');

drop policy if exists supplement_images_service_role_write on storage.objects;
create policy supplement_images_service_role_write on storage.objects
  for all
  to service_role
  using (bucket_id = 'supplement-images')
  with check (bucket_id = 'supplement-images');

drop policy if exists personalization_artifacts_service_role_access on storage.objects;
create policy personalization_artifacts_service_role_access on storage.objects
  for all
  to service_role
  using (bucket_id = 'personalization-artifacts')
  with check (bucket_id = 'personalization-artifacts');

drop policy if exists user_profile_photos_select_own on storage.objects;
create policy user_profile_photos_select_own on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'user-profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists user_profile_photos_insert_own on storage.objects;
create policy user_profile_photos_insert_own on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'user-profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists user_profile_photos_update_own on storage.objects;
create policy user_profile_photos_update_own on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'user-profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'user-profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists user_profile_photos_delete_own on storage.objects;
create policy user_profile_photos_delete_own on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'user-profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists scan_history_select_own on storage.objects;
create policy scan_history_select_own on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'scan-history'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists scan_history_insert_own on storage.objects;
create policy scan_history_insert_own on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'scan-history'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists scan_history_update_own on storage.objects;
create policy scan_history_update_own on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'scan-history'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'scan-history'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists scan_history_delete_own on storage.objects;
create policy scan_history_delete_own on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'scan-history'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
