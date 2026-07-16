-- Per-task audit log of lifecycle events, populated from inside each
-- existing lifecycle RPC right after its state-changing update/insert.
create table if not exists public.task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event text not null,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.task_history enable row level security;

drop policy if exists "task_history_select" on public.task_history;
create policy "task_history_select" on public.task_history
  for select to authenticated using (
    exists (
      select 1 from public.tasks t
      where t.id = task_history.task_id
        and (
          t.assignee_id = auth.uid()
          or exists (select 1 from public.team_members where team_id = t.team_id and user_id = auth.uid() and status = 'active')
          or exists (select 1 from public.teams where id = t.team_id and owner_id = auth.uid())
        )
    )
  );

-- Re-published (7th time) with a "created" history entry.
create or replace function public.task_create(
  _team_id uuid, _title text, _description text, _difficulty text,
  _job_types text[], _due_date timestamptz, _reward numeric default null,
  _attachment_msg_id int default null, _attachment_name text default null, _attachment_size int default null,
  _priority text default 'normal', _tags text[] default '{}'
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
    attachment_msg_id, attachment_name, attachment_size, priority, tags
  ) values (
    _team_id, auth.uid(), coalesce(candidate, auth.uid()), _title, _description,
    'todo', _due_date, _difficulty, _reward, _job_types, 1, now() + interval '48 hours',
    _attachment_msg_id, _attachment_name, _attachment_size, _priority, _tags
  ) returning * into t;

  insert into public.task_history (task_id, actor_id, event, detail) values (t.id, auth.uid(), 'created', null);

  return t;
end;
$$;

create or replace function public.task_accept(_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count int;
begin
  select count(*) into active_count from public.tasks
    where assignee_id = auth.uid() and status = 'in_progress';
  if active_count >= 3 then raise exception 'You already have 3 tasks in progress'; end if;

  update public.tasks set status = 'in_progress'
    where id = _task_id and assignee_id = auth.uid() and status = 'todo';
  insert into public.task_history (task_id, actor_id, event) values (_task_id, auth.uid(), 'accepted');
end;
$$;

-- Re-published (3rd time) with a history entry added.
create or replace function public.task_decline(_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tasks;
  primary_job text;
  next_user uuid;
begin
  select * into t from public.tasks where id = _task_id and assignee_id = auth.uid() and status = 'todo' for update;
  if not found then raise exception 'Task not found or not declinable'; end if;

  primary_job := t.job_types[1];
  next_user := public.team_next_priority_candidate(t.team_id, primary_job, t.priority_index, auth.uid());

  if next_user is not null then
    update public.tasks set assignee_id = next_user, priority_index = priority_index + 1, offer_expires_at = now() + interval '48 hours'
      where id = _task_id;
    insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'declined', 'reassigned to next candidate');
  else
    update public.tasks set assignee_id = t.creator_id, status = 'cancelled' where id = _task_id;
    insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'declined', 'no candidate left, cancelled');
  end if;
end;
$$;

create or replace function public.task_submit(_task_id uuid, _type text, _content text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tasks set status = 'under_review', submission_type = _type, submission_content = _content
    where id = _task_id and assignee_id = auth.uid() and status = 'in_progress';
  insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'submitted', _type);
end;
$$;

-- Re-published (7th time) with a history entry added.
create or replace function public.task_approve(_task_id uuid, _rating int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tasks;
  done_count int;
  personal_done_count int;
begin
  select * into t from public.tasks where id = _task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not public.team_member_has_perm(t.team_id, 'can_review_tasks') then raise exception 'Not authorized'; end if;

  update public.tasks set status = 'done', rating = _rating, completed_at = now() where id = _task_id;
  insert into public.team_activity_log (team_id) values (t.team_id);
  insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'approved', 'rating ' || _rating);

  if t.reward is not null and t.reward > 0 then
    update public.team_members set balance = balance + t.reward
      where team_id = t.team_id and user_id = t.assignee_id;
    insert into public.transactions (team_id, sender_id, receiver_id, amount, details)
      values (t.team_id, null, t.assignee_id, t.reward, 'Task reward: ' || t.title);
  end if;

  select count(*) into done_count from public.tasks where team_id = t.team_id and status = 'done';
  if done_count >= 100 then
    perform public.award_badge_if_missing(t.team_id, 'tasks-100', '100 Tasks Completed');
  end if;

  select count(*) into personal_done_count from public.tasks where team_id = t.team_id and assignee_id = t.assignee_id and status = 'done';
  if personal_done_count >= 10 then
    perform public.award_member_badge_if_missing(t.team_id, t.assignee_id, 'tasks-done-10', '10 Tasks Completed');
  end if;
  if personal_done_count >= 50 then
    perform public.award_member_badge_if_missing(t.team_id, t.assignee_id, 'tasks-done-50', '50 Tasks Completed');
  end if;
  if personal_done_count >= 100 then
    perform public.award_member_badge_if_missing(t.team_id, t.assignee_id, 'tasks-done-100', '100 Tasks Completed');
  end if;
end;
$$;

-- Re-published (3rd time) with a history entry added.
create or replace function public.task_reject_submission(_task_id uuid, _notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = _task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not public.team_member_has_perm(t.team_id, 'can_review_tasks') then raise exception 'Not authorized'; end if;

  update public.tasks set status = 'in_progress', description = description || E'\n\nRevision requested: ' || _notes
    where id = _task_id;
  insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'rejected', _notes);
end;
$$;
