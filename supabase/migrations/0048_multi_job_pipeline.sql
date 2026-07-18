-- Two upgrades to the existing priority-based task-assignment system
-- (0008/0009/.../0040): (1) a member can now hold multiple jobs, each with
-- its own priority, instead of the single team_members.job_title/priority
-- pair; (2) a task's job_types array becomes a real ordered pipeline —
-- completing one stage auto-offers the next job_type in the array to its
-- priority-1 holder, instead of every task being a single-stage job_types[1]
-- offer. team_members.job_title/priority are left in place (display-only
-- now) — team_member_jobs is the new source of truth for assignment.
--
-- task_create/task_decline/task_submit/task_approve below are rebuilt from
-- their latest prior versions (0040 for task_create, 0035 for the rest) so
-- task_history logging, the team_activity_log insert, and badge-award calls
-- in task_approve are preserved exactly, not dropped.

-- ---------------------------------------------------------------------------
-- Multi-job priority
-- ---------------------------------------------------------------------------

create table if not exists public.team_member_jobs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_type text not null,
  priority int not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, job_type, priority),
  unique (team_id, user_id, job_type)
);

create index if not exists team_member_jobs_lookup_idx on public.team_member_jobs(team_id, job_type, priority);

alter table public.team_member_jobs enable row level security;

drop policy if exists "team_member_jobs_select" on public.team_member_jobs;
create policy "team_member_jobs_select" on public.team_member_jobs
  for select to authenticated using (public.is_team_active_member(team_id) or public.is_team_owner(team_id));

-- Writes go through claim_job_priority/remove_member_job/admin_set_member_job
-- (SECURITY DEFINER) below — no direct-write policy needed.

-- Smallest priority >= _requested not already taken for this job_type on
-- this team (same collision-avoidance rule as team_collision_free_priority,
-- now per job_type rather than per single job_title column).
create or replace function public.team_job_collision_free_priority(_team_id uuid, _job_type text, _requested int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate int := greatest(_requested, 1);
begin
  loop
    exit when not exists (
      select 1 from public.team_member_jobs
      where team_id = _team_id and job_type = _job_type and priority = candidate
    );
    candidate := candidate + 1;
  end loop;
  return candidate;
end;
$$;

-- Member sets/updates their own priority for a job — colliding with an
-- existing holder bumps the caller to the next free slot rather than
-- rejecting, matching "if priority is taken system automatically changes
-- priority."
create or replace function public.claim_job_priority(_team_id uuid, _job_type text, _requested int)
returns public.team_member_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  final_prio int;
  row public.team_member_jobs;
begin
  if not exists (select 1 from public.team_members where team_id = _team_id and user_id = auth.uid() and status = 'active') then
    raise exception 'Not an active member of this team';
  end if;

  delete from public.team_member_jobs where team_id = _team_id and user_id = auth.uid() and job_type = _job_type;
  final_prio := public.team_job_collision_free_priority(_team_id, _job_type, _requested);

  insert into public.team_member_jobs (team_id, user_id, job_type, priority)
  values (_team_id, auth.uid(), _job_type, final_prio)
  returning * into row;
  return row;
end;
$$;

create or replace function public.remove_member_job(_team_id uuid, _job_type text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.team_member_jobs where team_id = _team_id and user_id = auth.uid() and job_type = _job_type;
$$;

create or replace function public.set_member_job_active(_team_id uuid, _job_type text, _active boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.team_member_jobs set active = _active, updated_at = now()
    where team_id = _team_id and user_id = auth.uid() and job_type = _job_type;
$$;

-- Admin/leader variant — sets another member's job+priority (Roles UI).
create or replace function public.admin_set_member_job(_team_id uuid, _user_id uuid, _job_type text, _requested int)
returns public.team_member_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  final_prio int;
  row public.team_member_jobs;
begin
  if not public.is_team_manager(_team_id) then raise exception 'Not authorized'; end if;

  delete from public.team_member_jobs where team_id = _team_id and user_id = _user_id and job_type = _job_type;
  final_prio := public.team_job_collision_free_priority(_team_id, _job_type, _requested);

  insert into public.team_member_jobs (team_id, user_id, job_type, priority)
  values (_team_id, _user_id, _job_type, final_prio)
  returning * into row;
  return row;
end;
$$;

create or replace function public.admin_remove_member_job(_team_id uuid, _user_id uuid, _job_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_team_manager(_team_id) then raise exception 'Not authorized'; end if;
  delete from public.team_member_jobs where team_id = _team_id and user_id = _user_id and job_type = _job_type;
end;
$$;

-- Next active, available holder of a job_type at or above a priority,
-- excluding one user (reassign-on-decline/expire) — mirrors
-- team_next_priority_candidate but reads team_member_jobs.
create or replace function public.team_job_next_candidate(_team_id uuid, _job_type text, _after_priority int, _exclude_user uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select tmj.user_id from public.team_member_jobs tmj
  join public.team_members tm on tm.team_id = tmj.team_id and tm.user_id = tmj.user_id
  where tmj.team_id = _team_id
    and tmj.job_type = _job_type
    and tmj.active = true
    and tmj.priority > _after_priority
    and tm.status = 'active' and tm.is_active = true and tm.member_status = 'active'
    and (_exclude_user is null or tmj.user_id != _exclude_user)
  order by tmj.priority asc
  limit 1;
$$;

create or replace function public.team_job_first_candidate(_team_id uuid, _job_type text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select public.team_job_next_candidate(_team_id, _job_type, 0, null);
$$;

-- ---------------------------------------------------------------------------
-- Pipeline stage progression
-- ---------------------------------------------------------------------------

alter table public.tasks add column if not exists stage_index int not null default 0;

create table if not exists public.task_stage_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  job_type text not null,
  assignee_id uuid references public.profiles(id) on delete set null,
  completed_at timestamptz not null default now()
);

alter table public.task_stage_history enable row level security;

drop policy if exists "task_stage_history_select" on public.task_stage_history;
create policy "task_stage_history_select" on public.task_stage_history
  for select to authenticated using (
    exists (select 1 from public.tasks t where t.id = task_stage_history.task_id
      and (t.assignee_id = auth.uid() or t.creator_id = auth.uid() or public.is_team_manager(t.team_id)))
  );

-- Rebuilt from 0040's task_create (latest): same signature, permission
-- check, manual-assignee override, and 'created' history entry — candidate
-- lookup now goes through team_member_jobs/team_job_first_candidate instead
-- of team_members.job_title/priority, and every new task starts at stage 0.
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
    candidate := public.team_job_first_candidate(_team_id, primary_job);
  end if;

  insert into public.tasks (
    team_id, creator_id, assignee_id, title, description, status, due_date,
    difficulty, reward, job_types, priority_index, stage_index, offer_expires_at,
    attachment_msg_id, attachment_name, attachment_size, priority, tags, recurrence
  ) values (
    _team_id, auth.uid(), coalesce(candidate, auth.uid()), _title, _description,
    'todo', _due_date, _difficulty, _reward, _job_types, 1, 0, coalesce(_offer_expires_at, now() + interval '48 hours'),
    _attachment_msg_id, _attachment_name, _attachment_size, _priority, _tags, _recurrence
  ) returning * into t;

  insert into public.task_history (task_id, actor_id, event, detail) values (t.id, auth.uid(), 'created', null);

  if candidate is not null then
    insert into public.notifications (user_id, title, body)
    values (candidate, 'New task offer: ' || _title, 'You''re priority for ' || primary_job || ' on this task.');
  end if;

  return t;
end;
$$;

-- Rebuilt from 0035's task_decline (latest): same history-entry behavior,
-- candidate lookup now scoped to the task's *current pipeline stage*
-- (job_types[stage_index+1]) via team_member_jobs instead of job_types[1]/
-- team_members, plus a notification to whoever the offer moves to.
create or replace function public.task_decline(_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tasks;
  stage_job text;
  next_user uuid;
begin
  select * into t from public.tasks where id = _task_id and assignee_id = auth.uid() and status = 'todo' for update;
  if not found then raise exception 'Task not found or not declinable'; end if;

  stage_job := t.job_types[t.stage_index + 1];
  next_user := public.team_job_next_candidate(t.team_id, stage_job, t.priority_index, auth.uid());

  if next_user is not null then
    update public.tasks set assignee_id = next_user, priority_index = priority_index + 1, offer_expires_at = now() + interval '48 hours'
      where id = _task_id;
    insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'declined', 'reassigned to next candidate');
    insert into public.notifications (user_id, title, body)
    values (next_user, 'New task offer: ' || t.title, 'You''re next in line for ' || stage_job || '.');
  else
    update public.tasks set assignee_id = t.creator_id, status = 'cancelled' where id = _task_id;
    insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'declined', 'no candidate left, cancelled');
    insert into public.notifications (user_id, title, body)
    values (t.creator_id, 'Task cancelled: ' || t.title, 'No available ' || stage_job || ' left to offer it to.');
  end if;
end;
$$;

-- Same offer-expiry sweep as 0009's version, now stage-aware and notifying
-- the newly-offered candidate (previously silent).
create or replace function public.expire_stale_task_offers(_team_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  stage_job text;
  next_user uuid;
  moved int := 0;
begin
  for t in
    select * from public.tasks
    where team_id = _team_id and status = 'todo' and offer_expires_at is not null and offer_expires_at < now()
  loop
    stage_job := t.job_types[t.stage_index + 1];
    next_user := public.team_job_next_candidate(_team_id, stage_job, t.priority_index, t.assignee_id);

    if next_user is not null then
      update public.tasks set assignee_id = next_user, priority_index = t.priority_index + 1, offer_expires_at = now() + interval '48 hours'
        where id = t.id;
      insert into public.task_history (task_id, actor_id, event, detail) values (t.id, null, 'offer_expired', 'reassigned to next candidate');
      insert into public.notifications (user_id, title, body)
      values (next_user, 'New task offer: ' || t.title, 'You''re next in line for ' || stage_job || ' (previous offer expired).');
    else
      update public.tasks set assignee_id = t.creator_id, status = 'cancelled' where id = t.id;
      insert into public.task_history (task_id, actor_id, event, detail) values (t.id, null, 'offer_expired', 'no candidate left, cancelled');
      insert into public.notifications (user_id, title, body)
      values (t.creator_id, 'Task cancelled: ' || t.title, 'Offer expired with no available ' || stage_job || ' left.');
    end if;
    moved := moved + 1;
  end loop;

  return moved;
end;
$$;

-- Rebuilt from 0035's task_submit (latest, just the 3-line unconditional
-- version). Submitting a stage now either advances the pipeline to the next
-- job_type (re-offering it exactly like task_create did for stage 0) or, on
-- the last stage, moves to under_review exactly as before. Every completed
-- stage is logged to task_stage_history so task_approve can pay every
-- contributor, not just whoever held the final stage.
create or replace function public.task_submit(_task_id uuid, _type text, _content text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tasks;
  completed_job text;
  next_job text;
  next_user uuid;
begin
  select * into t from public.tasks where id = _task_id and assignee_id = auth.uid() and status = 'in_progress' for update;
  if not found then raise exception 'Task not found or not submittable'; end if;

  completed_job := t.job_types[t.stage_index + 1];
  insert into public.task_stage_history (task_id, job_type, assignee_id) values (_task_id, completed_job, auth.uid());

  if t.stage_index + 2 <= array_length(t.job_types, 1) then
    next_job := t.job_types[t.stage_index + 2];
    next_user := public.team_job_first_candidate(t.team_id, next_job);

    update public.tasks set
      stage_index = stage_index + 1,
      priority_index = 1,
      assignee_id = coalesce(next_user, t.creator_id),
      status = 'todo',
      offer_expires_at = now() + interval '48 hours',
      submission_type = null, submission_content = null
    where id = _task_id;

    insert into public.task_history (task_id, actor_id, event, detail)
      values (_task_id, auth.uid(), 'stage_submitted', completed_job || ' done, next: ' || next_job);

    if next_user is not null then
      insert into public.notifications (user_id, title, body)
      values (next_user, 'New task offer: ' || t.title, completed_job || ' is done — you''re priority for ' || next_job || '.');
    else
      insert into public.notifications (user_id, title, body)
      values (t.creator_id, 'No one available for ' || next_job, '"' || t.title || '" needs a ' || next_job || ' holder to continue.');
    end if;
  else
    update public.tasks set status = 'under_review', submission_type = _type, submission_content = _content
      where id = _task_id;
    insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'submitted', _type);
  end if;
end;
$$;

-- Rebuilt from 0035's task_approve (latest — includes team_activity_log and
-- badge-award calls, preserved verbatim below). The only behavioral change:
-- the reward is split evenly across every distinct contributor recorded in
-- task_stage_history instead of paid entirely to the final-stage assignee.
-- Falls back to the task's own assignee for legacy/single-stage tasks with
-- no history rows, so a non-pipeline task pays exactly as it did before.
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
  contributor uuid;
  contributors uuid[];
  share numeric;
begin
  select * into t from public.tasks where id = _task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not public.team_member_has_perm(t.team_id, 'can_review_tasks') then raise exception 'Not authorized'; end if;

  update public.tasks set status = 'done', rating = _rating, completed_at = now() where id = _task_id;
  insert into public.team_activity_log (team_id) values (t.team_id);
  insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'approved', 'rating ' || _rating);

  select array_agg(distinct assignee_id) into contributors
    from public.task_stage_history where task_id = _task_id and assignee_id is not null;
  if contributors is null or array_length(contributors, 1) is null then
    contributors := array[t.assignee_id];
  end if;

  if t.reward is not null and t.reward > 0 and array_length(contributors, 1) > 0 then
    share := round(t.reward / array_length(contributors, 1), 2);
    foreach contributor in array contributors loop
      update public.team_members set balance = balance + share where team_id = t.team_id and user_id = contributor;
      insert into public.transactions (team_id, sender_id, receiver_id, amount, details)
        values (t.team_id, null, contributor, share, 'Task reward: ' || t.title);
      insert into public.notifications (user_id, title, body)
        values (contributor, 'Task approved: ' || t.title, 'You earned $' || share || '.');
    end loop;
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

revoke all on function public.claim_job_priority(uuid, text, int) from public;
revoke all on function public.remove_member_job(uuid, text) from public;
revoke all on function public.set_member_job_active(uuid, text, boolean) from public;
revoke all on function public.admin_set_member_job(uuid, uuid, text, int) from public;
revoke all on function public.admin_remove_member_job(uuid, uuid, text) from public;
grant execute on function public.claim_job_priority(uuid, text, int) to authenticated;
grant execute on function public.remove_member_job(uuid, text) to authenticated;
grant execute on function public.set_member_job_active(uuid, text, boolean) to authenticated;
grant execute on function public.admin_set_member_job(uuid, uuid, text, int) to authenticated;
grant execute on function public.admin_remove_member_job(uuid, uuid, text) to authenticated;
