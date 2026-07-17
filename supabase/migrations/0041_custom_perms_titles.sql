-- Free-form permission tags (beyond the fixed can_* set) and a display title
-- per member (e.g. "Bank Officer"), distinct from job_title (a JOB_TITLES enum
-- used for task auto-assignment routing).
alter table public.team_members add column if not exists custom_permissions text[] not null default '{}';
alter table public.team_members add column if not exists custom_title text;

-- Re-published to also allow an admin-defined custom permission tag.
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
      and (
        case _perm
          when 'can_review_tasks' then tm.can_review_tasks
          when 'can_manage_bank' then tm.can_manage_bank
          when 'can_manage_join_requests' then tm.can_manage_join_requests
          when 'can_manage_vacations' then tm.can_manage_vacations
          when 'can_manage_tasks' then tm.can_manage_tasks
          else false
        end
        or tm.custom_permissions @> array[_perm]
      )
  );
end;
$$;
