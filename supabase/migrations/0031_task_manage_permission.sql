-- Task creation was hard-gated to role='leader' (via is_team_manager), unlike
-- review/bank/join-requests/vacations which use the delegable 4-flag model
-- on team_members. Adds a 5th flag so task creation can also be delegated.
alter table public.team_members add column if not exists can_manage_tasks boolean not null default false;

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
        else false
      end
  );
end;
$$;

-- Re-published (5th time, this pass adds priority/tags columns handled by a
-- later migration) to accept delegated task-creation permission alongside
-- the existing blanket leader/owner access.
create or replace function public.task_create(
  _team_id uuid, _title text, _description text, _difficulty text,
  _job_types text[], _due_date timestamptz, _reward numeric default null,
  _attachment_msg_id int default null, _attachment_name text default null, _attachment_size int default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  primary_job text;
  candidate uuid;
  t public.tasks;
begin
  if not (public.is_team_manager(_team_id) or public.team_member_has_perm(_team_id, 'can_manage_tasks')) then
    raise exception 'Not authorized';
  end if;

  primary_job := _job_types[1];

  select user_id into candidate from public.team_members
    where team_id = _team_id and job_title = primary_job and priority = 1
      and status = 'active' and is_active = true and member_status = 'active'
    limit 1;

  insert into public.tasks (
    team_id, creator_id, assignee_id, title, description, status, due_date,
    difficulty, reward, job_types, priority_index, offer_expires_at,
    attachment_msg_id, attachment_name, attachment_size
  ) values (
    _team_id, auth.uid(), coalesce(candidate, auth.uid()), _title, _description,
    'todo', _due_date, _difficulty, _reward, _job_types, 1, now() + interval '48 hours',
    _attachment_msg_id, _attachment_name, _attachment_size
  ) returning * into t;

  return t;
end;
$$;
