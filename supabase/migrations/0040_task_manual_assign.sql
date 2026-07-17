-- Surfaces the existing (previously backend-only) offer_expires_at column and
-- lets a manager override auto-assignment with a specific member.
-- Re-published (9th time) to accept an optional assignee override and an
-- explicit offer-expiry timestamp instead of always defaulting to now()+48h.
create or replace function public.task_create(
  _team_id uuid, _title text, _description text, _difficulty text,
  _job_types text[], _due_date timestamptz, _reward numeric default null,
  _attachment_msg_id int default null, _attachment_name text default null, _attachment_size int default null,
  _priority text default 'normal', _tags text[] default '{}', _recurrence text default 'none',
  _assignee_id uuid default null, _offer_expires_at timestamptz default null
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

  if _assignee_id is not null then
    if not exists (
      select 1 from public.team_members
      where team_id = _team_id and user_id = _assignee_id and status = 'active'
    ) then
      raise exception 'Chosen assignee is not an active member of this team';
    end if;
    candidate := _assignee_id;
  else
    select user_id into candidate from public.team_members
      where team_id = _team_id and job_title = primary_job and priority = 1
        and status = 'active' and is_active = true and member_status = 'active'
      limit 1;
  end if;

  insert into public.tasks (
    team_id, creator_id, assignee_id, title, description, status, due_date,
    difficulty, reward, job_types, priority_index, offer_expires_at,
    attachment_msg_id, attachment_name, attachment_size, priority, tags, recurrence
  ) values (
    _team_id, auth.uid(), coalesce(candidate, auth.uid()), _title, _description,
    'todo', _due_date, _difficulty, _reward, _job_types, 1, coalesce(_offer_expires_at, now() + interval '48 hours'),
    _attachment_msg_id, _attachment_name, _attachment_size, _priority, _tags, _recurrence
  ) returning * into t;

  insert into public.task_history (task_id, actor_id, event, detail) values (t.id, auth.uid(), 'created', null);

  return t;
end;
$$;
