-- Profile photos and team logos/join-ads were stored as inline base64 data
-- URLs (in `profiles.avatar` / `teams.logo` / `teams.join_ad_url`), bloating
-- those tables and every query that selects them. Move the bytes into
-- Supabase Storage instead; the DB columns keep the same type (text) but
-- now hold a public Storage URL.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Path convention: `<auth.uid()>/...` for personal avatars,
-- `teams/<team_id>/...` for team logos/join-ads (team ownership checked
-- against the teams table rather than the uid-prefix trick, since the
-- uploader is the team owner, not the path owner).
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select to public using (bucket_id = 'avatars');

drop policy if exists "avatars_write_own" on storage.objects;
create policy "avatars_write_own" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.teams
        where id::text = (storage.foldername(name))[2]
          and owner_id = auth.uid()
          and (storage.foldername(name))[1] = 'teams'
      )
    )
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated using (
    bucket_id = 'avatars' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.teams
        where id::text = (storage.foldername(name))[2]
          and owner_id = auth.uid()
          and (storage.foldername(name))[1] = 'teams'
      )
    )
  );
