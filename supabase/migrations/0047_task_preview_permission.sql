-- New grantable sub-admin permission: view-only access to a team's task
-- board without full create/manage rights (can_manage_tasks). Follows the
-- existing explicit-boolean-per-permission pattern (can_manage_bank etc,
-- migration 0031) rather than the unenforced custom_permissions free-text
-- array — see teams.ts.
alter table public.team_members add column if not exists can_preview_tasks boolean not null default false;

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
        else false
      end
  );
end;
$$;
