-- Two new grantable sub-admin permissions, following the existing
-- explicit-boolean-per-permission pattern (0031, 0047) rather than the
-- unenforced custom_permissions free-text array — see teams.ts.
--
-- can_manage_cloud_files: lets an owner delegate Team Cloud folder/file
-- administration (create/delete folders, edit folder membership, set cover
-- images, change file visibility) without granting the rest of what a
-- leader's blanket canManage implies. Team Cloud client code currently gates
-- these actions on generic canManage; this migration only adds the flag and
-- RLS-visible permission check — the client switches to checking it
-- separately from canManage.
--
-- can_manage_members: lets an owner delegate roster editing (job title,
-- priority, permission flags, custom title) to a leader. team_members
-- UPDATE was previously owner-only (0004_fix_rls_recursion.sql) even though
-- the UI already opened the edit modal for any leader — a save by a
-- non-owner leader silently failed. This closes that gap in a
-- permission-gated way rather than opening it to every leader.
alter table public.team_members add column if not exists can_manage_cloud_files boolean not null default false;
alter table public.team_members add column if not exists can_manage_members boolean not null default false;

create or replace function public.team_member_has_perm(_team_id uuid, _perm text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if public.is_team_owner(_team_id) then
    return true;
  end if;

  return exists (
    select 1 from public.team_members tm
    where tm.team_id = _team_id and tm.user_id = auth.uid() and tm.status = 'active' and tm.role = 'leader'
      and case _perm
        when 'can_review_tasks' then tm.can_review_tasks
        when 'can_manage_bank' then tm.can_manage_bank
        when 'can_manage_join_requests' then tm.can_manage_join_requests
        when 'can_manage_vacations' then tm.can_manage_vacations
        when 'can_manage_tasks' then tm.can_manage_tasks
        when 'can_preview_tasks' then tm.can_preview_tasks
        when 'can_manage_cloud_files' then tm.can_manage_cloud_files
        when 'can_manage_members' then tm.can_manage_members
        else false
      end
  );
end;
$$;

drop policy if exists "team_members_update" on public.team_members;
create policy "team_members_update" on public.team_members
  for update to authenticated using (
    (invited_email = auth.jwt()->>'email' and status = 'pending')
    or public.is_team_owner(team_id)
    or public.team_member_has_perm(team_id, 'can_manage_members')
  ) with check (
    (invited_email = auth.jwt()->>'email' and user_id = auth.uid())
    or public.is_team_owner(team_id)
    or public.team_member_has_perm(team_id, 'can_manage_members')
  );
