-- Presentation/visibility metadata for Team Cloud files. File bytes live in
-- the team's Telegram channel (see cloudClient.ts) — there is no Supabase
-- Storage object to attach RLS to, so this table is the enforcement point
-- for visibility and the source of cover images / uploader identity / a
-- friendly display name, keyed by the Telegram message id that carries the
-- file. A file with no row here defaults to team-visible (unchanged legacy
-- behavior).
create table if not exists public.team_cloud_files (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  channel_msg_id bigint not null,
  folder_msg_id bigint,
  uploader_user_id uuid references public.profiles(id) on delete set null,
  visibility text not null default 'team' check (visibility in ('public', 'team', 'private')),
  owner_user_id uuid references public.profiles(id) on delete set null,
  cover_image_path text,
  cover_version int not null default 0,
  display_name text,
  is_chat_upload boolean not null default false,
  created_at timestamptz not null default now(),
  unique (team_id, channel_msg_id)
);

alter table public.team_cloud_files enable row level security;

drop policy if exists "team_cloud_files_select" on public.team_cloud_files;
create policy "team_cloud_files_select" on public.team_cloud_files
  for select to authenticated using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = team_cloud_files.team_id and tm.user_id = auth.uid() and tm.status = 'active'
      and (
        team_cloud_files.visibility <> 'private'
        or team_cloud_files.owner_user_id = auth.uid()
        or public.team_member_has_perm(team_cloud_files.team_id, 'can_manage_tasks')
        or tm.role = 'leader'
      )
    )
  );

drop policy if exists "team_cloud_files_write" on public.team_cloud_files;
create policy "team_cloud_files_write" on public.team_cloud_files
  for all to authenticated using (
    exists (select 1 from public.team_members tm where tm.team_id = team_cloud_files.team_id and tm.user_id = auth.uid() and tm.status = 'active')
  ) with check (
    exists (select 1 from public.team_members tm where tm.team_id = team_cloud_files.team_id and tm.user_id = auth.uid() and tm.status = 'active')
  );

-- Per-team-channel-folder metadata (secrecy flag) — folders themselves are
-- Telegram messages with no room for this, same pattern as team_cloud_files.
create table if not exists public.team_cloud_folders (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  folder_msg_id bigint not null,
  is_secret boolean not null default false,
  created_at timestamptz not null default now(),
  unique (team_id, folder_msg_id)
);

alter table public.team_cloud_folders enable row level security;

drop policy if exists "team_cloud_folders_select" on public.team_cloud_folders;
create policy "team_cloud_folders_select" on public.team_cloud_folders
  for select to authenticated using (
    exists (select 1 from public.team_members tm where tm.team_id = team_cloud_folders.team_id and tm.user_id = auth.uid() and tm.status = 'active')
  );

drop policy if exists "team_cloud_folders_write" on public.team_cloud_folders;
create policy "team_cloud_folders_write" on public.team_cloud_folders
  for all to authenticated using (
    exists (select 1 from public.team_members tm where tm.team_id = team_cloud_folders.team_id and tm.user_id = auth.uid() and tm.status = 'active')
  ) with check (
    exists (select 1 from public.team_members tm where tm.team_id = team_cloud_folders.team_id and tm.user_id = auth.uid() and tm.status = 'active')
  );
