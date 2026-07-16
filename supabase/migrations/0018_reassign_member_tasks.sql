-- When a member goes on leave/resigns, their open tasks would otherwise sit
-- orphaned until someone manually reassigns each one individually. This lets
-- a leader move every open (not done/cancelled) task from one member to
-- another in one call.
create or replace function public.reassign_member_tasks(_team_id uuid, _from_user uuid, _to_user uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  moved int;
begin
  if not public.team_member_has_perm(_team_id, 'can_review_tasks') then raise exception 'Not authorized'; end if;

  update public.tasks
  set assignee_id = _to_user
  where team_id = _team_id and assignee_id = _from_user and status not in ('done', 'cancelled');
  get diagnostics moved = row_count;
  return moved;
end;
$$;

revoke all on function public.reassign_member_tasks(uuid, uuid, uuid) from public;
grant execute on function public.reassign_member_tasks(uuid, uuid, uuid) to authenticated;
