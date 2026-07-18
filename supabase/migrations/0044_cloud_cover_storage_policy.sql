-- Team Cloud file covers reuse the existing `avatars` bucket (it already
-- holds non-avatar images — team logos/join-ads, see migration 0014) under
-- `teams/<team_id>/cloud-covers/...`. Write access is granted to any active
-- member with task-management rights on that team, not just the literal
-- team owner (unlike the logo/join-ad path), since any team admin should be
-- able to set a cover on a Team Cloud file.
drop policy if exists "avatars_write_cloud_covers" on storage.objects;
create policy "avatars_write_cloud_covers" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'teams'
    and (storage.foldername(name))[3] = 'cloud-covers'
    and public.team_member_has_perm((storage.foldername(name))[2]::uuid, 'can_manage_tasks')
  );

drop policy if exists "avatars_update_cloud_covers" on storage.objects;
create policy "avatars_update_cloud_covers" on storage.objects
  for update to authenticated using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'teams'
    and (storage.foldername(name))[3] = 'cloud-covers'
    and public.team_member_has_perm((storage.foldername(name))[2]::uuid, 'can_manage_tasks')
  );
