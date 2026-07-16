-- Recurring tasks. Mirrors the existing lazy-trigger pattern of
-- expire_stale_task_offers/notify_upcoming_task_deadlines — spawn_recurring_tasks
-- is safe to call opportunistically from the client (no real cron in this project).
alter table public.tasks add column if not exists recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly'));
alter table public.tasks add column if not exists recurrence_parent_id uuid references public.tasks(id);
alter table public.tasks add column if not exists next_occurrence_at timestamptz;

create or replace function public.spawn_recurring_tasks(_team_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  spawned int := 0;
  next_due timestamptz;
  candidate uuid;
  new_task_id uuid;
begin
  for t in
    select * from public.tasks
    where team_id = _team_id
      and recurrence <> 'none'
      and status in ('done', 'cancelled')
      and (next_occurrence_at is null or next_occurrence_at <= now())
  loop
    select user_id into candidate from public.team_members
      where team_id = _team_id and job_title = t.job_types[1] and priority = 1
        and status = 'active' and is_active = true and member_status = 'active'
      limit 1;

    insert into public.tasks (
      team_id, creator_id, assignee_id, title, description, status, due_date,
      difficulty, reward, job_types, priority_index, offer_expires_at,
      priority, tags, recurrence, recurrence_parent_id
    ) values (
      _team_id, t.creator_id, coalesce(candidate, t.creator_id), t.title, t.description, 'todo', null,
      t.difficulty, t.reward, t.job_types, 1, now() + interval '48 hours',
      t.priority, t.tags, 'none', t.id
    ) returning id into new_task_id;

    next_due := case t.recurrence
      when 'daily' then now() + interval '1 day'
      when 'weekly' then now() + interval '7 days'
      when 'monthly' then now() + interval '1 month'
    end;
    update public.tasks set next_occurrence_at = next_due where id = t.id;

    insert into public.task_history (task_id, event, detail) values (new_task_id, 'created', 'recurring copy of ' || t.title);
    spawned := spawned + 1;
  end loop;
  return spawned;
end;
$$;

revoke all on function public.spawn_recurring_tasks(uuid) from public;
grant execute on function public.spawn_recurring_tasks(uuid) to authenticated;

-- Re-published (8th time) to accept a recurrence setting at creation.
create or replace function public.task_create(
  _team_id uuid, _title text, _description text, _difficulty text,
  _job_types text[], _due_date timestamptz, _reward numeric default null,
  _attachment_msg_id int default null, _attachment_name text default null, _attachment_size int default null,
  _priority text default 'normal', _tags text[] default '{}', _recurrence text default 'none'
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
    attachment_msg_id, attachment_name, attachment_size, priority, tags, recurrence
  ) values (
    _team_id, auth.uid(), coalesce(candidate, auth.uid()), _title, _description,
    'todo', _due_date, _difficulty, _reward, _job_types, 1, now() + interval '48 hours',
    _attachment_msg_id, _attachment_name, _attachment_size, _priority, _tags, _recurrence
  ) returning * into t;

  insert into public.task_history (task_id, actor_id, event, detail) values (t.id, auth.uid(), 'created', null);

  return t;
end;
$$;
