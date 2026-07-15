-- Teams stage 4: full team-ops system (task workflow, wallet, leave/resignation,
-- check-in streaks, priority-based auto-assignment) ported from the Telegram bot
-- to the web app. Sensitive mutations (balance changes, priority collisions,
-- check-in streaks, task lifecycle) go through SECURITY DEFINER RPC functions
-- instead of direct table writes, so RLS stays simple and the server enforces
-- the business rules the bot used to enforce itself.
-- Run this once in the Supabase SQL editor for this project.

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------

alter table public.team_members add column if not exists job_title text;
alter table public.team_members add column if not exists priority int;
alter table public.team_members add column if not exists balance numeric not null default 0;
alter table public.team_members add column if not exists is_active boolean not null default true;
alter table public.team_members add column if not exists member_status text not null default 'active';
alter table public.team_members add column if not exists streak_count int not null default 0;
alter table public.team_members add column if not exists last_check_in timestamptz;

do $$ begin
  alter table public.team_members add constraint team_members_status_check
    check (member_status in ('active', 'on_leave', 'resigned'));
exception when duplicate_object then null; end $$;

alter table public.tasks add column if not exists difficulty text not null default 'Medium';
alter table public.tasks add column if not exists reward numeric;
alter table public.tasks add column if not exists job_types text[] not null default '{}';
alter table public.tasks add column if not exists submission_type text;
alter table public.tasks add column if not exists submission_content text;
alter table public.tasks add column if not exists rating int;
alter table public.tasks add column if not exists priority_index int not null default 1;

do $$ begin
  alter table public.tasks add constraint tasks_difficulty_check
    check (difficulty in ('Easy', 'Medium', 'Hard'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.tasks add constraint tasks_status_check2
    check (status in ('todo', 'in_progress', 'under_review', 'done', 'cancelled'));
exception when duplicate_object then null; end $$;

-- Widen the original 0007 status check (todo|done) to the fuller lifecycle above.
alter table public.tasks drop constraint if exists tasks_status_check;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null,
  details text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint withdrawals_status_check check (status in ('pending', 'approved', 'rejected'))
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text default '',
  duration text default '',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint leave_requests_status_check check (status in ('pending', 'approved', 'rejected'))
);

create table if not exists public.resignation_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text default '',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint resignation_requests_status_check check (status in ('pending', 'approved', 'rejected'))
);

alter table public.transactions enable row level security;
alter table public.withdrawals enable row level security;
alter table public.leave_requests enable row level security;
alter table public.resignation_requests enable row level security;

-- All four tables share the same visibility shape: the row's own user, or the
-- team's owner/leader. Writes happen exclusively through the RPC functions
-- below (SECURITY DEFINER), so there are no client-facing insert/update policies.

drop policy if exists "transactions_select" on public.transactions;
create policy "transactions_select" on public.transactions
  for select to authenticated using (
    sender_id = auth.uid() or receiver_id = auth.uid()
    or public.is_team_owner(team_id) or public.is_team_leader(team_id)
  );

drop policy if exists "withdrawals_select" on public.withdrawals;
create policy "withdrawals_select" on public.withdrawals
  for select to authenticated using (
    user_id = auth.uid() or public.is_team_owner(team_id) or public.is_team_leader(team_id)
  );

drop policy if exists "leave_requests_select" on public.leave_requests;
create policy "leave_requests_select" on public.leave_requests
  for select to authenticated using (
    user_id = auth.uid() or public.is_team_owner(team_id) or public.is_team_leader(team_id)
  );

drop policy if exists "resignation_requests_select" on public.resignation_requests;
create policy "resignation_requests_select" on public.resignation_requests
  for select to authenticated using (
    user_id = auth.uid() or public.is_team_owner(team_id) or public.is_team_leader(team_id)
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_team_manager(_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_team_owner(_team_id) or public.is_team_leader(_team_id);
$$;

-- Smallest priority >= _requested not already taken by an active member with
-- the same job title on this team (mirrors the bot's getCollisionFreePriority).
create or replace function public.team_collision_free_priority(_team_id uuid, _job_title text, _requested int)
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
      select 1 from public.team_members
      where team_id = _team_id and job_title = _job_title and priority = candidate and status = 'active'
    );
    candidate := candidate + 1;
  end loop;
  return candidate;
end;
$$;

-- Next active, available member (not on leave/resigned) of a job title at or
-- above the given priority, excluding one user (used for reassign-on-decline).
create or replace function public.team_next_priority_candidate(_team_id uuid, _job_title text, _after_priority int, _exclude_user uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select user_id from public.team_members
  where team_id = _team_id
    and job_title = _job_title
    and status = 'active'
    and is_active = true
    and member_status = 'active'
    and priority > _after_priority
    and (_exclude_user is null or user_id != _exclude_user)
  order by priority asc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Member self-service RPCs
-- ---------------------------------------------------------------------------

create or replace function public.team_check_in(_team_id uuid)
returns public.team_members
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.team_members;
  new_streak int;
  hours_since numeric;
begin
  select * into m from public.team_members
    where team_id = _team_id and user_id = auth.uid() and status = 'active'
    for update;
  if not found then
    raise exception 'Not an active member of this team';
  end if;

  if m.last_check_in is not null then
    hours_since := extract(epoch from (now() - m.last_check_in)) / 3600;
    if hours_since < 20 then
      raise exception 'Already checked in today';
    elsif hours_since <= 48 then
      new_streak := m.streak_count + 1;
    else
      new_streak := 1;
    end if;
  else
    new_streak := 1;
  end if;

  update public.team_members set last_check_in = now(), streak_count = new_streak
    where id = m.id
    returning * into m;
  return m;
end;
$$;

create or replace function public.team_set_active(_team_id uuid, _is_active boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.team_members set is_active = _is_active
    where team_id = _team_id and user_id = auth.uid() and status = 'active';
$$;

create or replace function public.team_change_priority(_team_id uuid, _requested int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  job text;
  final_prio int;
begin
  select job_title into job from public.team_members
    where team_id = _team_id and user_id = auth.uid() and status = 'active';
  if job is null then
    raise exception 'No job title set for this member';
  end if;

  final_prio := public.team_collision_free_priority(_team_id, job, _requested);
  update public.team_members set priority = final_prio
    where team_id = _team_id and user_id = auth.uid() and status = 'active';
  return final_prio;
end;
$$;

create or replace function public.request_leave(_team_id uuid, _reason text, _duration text)
returns public.leave_requests
language sql
security definer
set search_path = public
as $$
  insert into public.leave_requests (team_id, user_id, reason, duration)
  values (_team_id, auth.uid(), _reason, _duration)
  returning *;
$$;

create or replace function public.decide_leave(_id uuid, _approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.leave_requests;
begin
  select * into r from public.leave_requests where id = _id and status = 'pending' for update;
  if not found then raise exception 'Request not found or already decided'; end if;
  if not public.is_team_manager(r.team_id) then raise exception 'Not authorized'; end if;

  if _approve then
    update public.leave_requests set status = 'approved' where id = _id;
    update public.team_members set member_status = 'on_leave' where team_id = r.team_id and user_id = r.user_id;
  else
    update public.leave_requests set status = 'rejected' where id = _id;
  end if;
end;
$$;

create or replace function public.request_resignation(_team_id uuid, _reason text)
returns public.resignation_requests
language sql
security definer
set search_path = public
as $$
  insert into public.resignation_requests (team_id, user_id, reason)
  values (_team_id, auth.uid(), _reason)
  returning *;
$$;

create or replace function public.decide_resignation(_id uuid, _approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.resignation_requests;
begin
  select * into r from public.resignation_requests where id = _id and status = 'pending' for update;
  if not found then raise exception 'Request not found or already decided'; end if;
  if not public.is_team_manager(r.team_id) then raise exception 'Not authorized'; end if;

  if _approve then
    update public.resignation_requests set status = 'approved' where id = _id;
    update public.team_members set member_status = 'resigned', is_active = false where team_id = r.team_id and user_id = r.user_id;
  else
    update public.resignation_requests set status = 'rejected' where id = _id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Wallet RPCs
-- ---------------------------------------------------------------------------

create or replace function public.wallet_deposit(_team_id uuid, _to_user uuid, _amount numeric, _details text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_team_manager(_team_id) then raise exception 'Not authorized'; end if;
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;

  update public.team_members set balance = balance + _amount where team_id = _team_id and user_id = _to_user;
  insert into public.transactions (team_id, sender_id, receiver_id, amount, details)
    values (_team_id, null, _to_user, _amount, _details);
end;
$$;

create or replace function public.wallet_penalize(_team_id uuid, _to_user uuid, _amount numeric, _details text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_team_manager(_team_id) then raise exception 'Not authorized'; end if;
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;

  update public.team_members set balance = balance - _amount where team_id = _team_id and user_id = _to_user;
  insert into public.transactions (team_id, sender_id, receiver_id, amount, details)
    values (_team_id, null, _to_user, -_amount, _details);
end;
$$;

create or replace function public.wallet_transfer(_team_id uuid, _to_user uuid, _amount numeric, _details text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sender_balance numeric;
begin
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;
  if _to_user = auth.uid() then raise exception 'Cannot transfer to yourself'; end if;

  select balance into sender_balance from public.team_members
    where team_id = _team_id and user_id = auth.uid() and status = 'active';
  if sender_balance is null then raise exception 'Not an active member of this team'; end if;
  if sender_balance < _amount then raise exception 'Insufficient balance'; end if;

  update public.team_members set balance = balance - _amount where team_id = _team_id and user_id = auth.uid();
  update public.team_members set balance = balance + _amount where team_id = _team_id and user_id = _to_user;
  insert into public.transactions (team_id, sender_id, receiver_id, amount, details)
    values (_team_id, auth.uid(), _to_user, _amount, _details);
end;
$$;

create or replace function public.wallet_request_withdrawal(_team_id uuid, _amount numeric)
returns public.withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  bal numeric;
  w public.withdrawals;
begin
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;
  select balance into bal from public.team_members
    where team_id = _team_id and user_id = auth.uid() and status = 'active';
  if bal is null or bal < _amount then raise exception 'Insufficient balance'; end if;

  update public.team_members set balance = balance - _amount where team_id = _team_id and user_id = auth.uid();
  insert into public.withdrawals (team_id, user_id, amount) values (_team_id, auth.uid(), _amount) returning * into w;
  return w;
end;
$$;

create or replace function public.wallet_decide_withdrawal(_id uuid, _approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.withdrawals;
begin
  select * into w from public.withdrawals where id = _id and status = 'pending' for update;
  if not found then raise exception 'Withdrawal not found or already decided'; end if;
  if not public.is_team_manager(w.team_id) then raise exception 'Not authorized'; end if;

  if _approve then
    update public.withdrawals set status = 'approved' where id = _id;
  else
    update public.withdrawals set status = 'rejected' where id = _id;
    update public.team_members set balance = balance + w.amount where team_id = w.team_id and user_id = w.user_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Task lifecycle RPCs
-- ---------------------------------------------------------------------------

create or replace function public.task_create(
  _team_id uuid, _title text, _description text, _difficulty text,
  _job_types text[], _due_date timestamptz, _reward numeric default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  primary_job text;
  candidate uuid;
  final_reward numeric;
  t public.tasks;
begin
  if not public.is_team_manager(_team_id) then raise exception 'Not authorized'; end if;

  primary_job := _job_types[1];
  final_reward := coalesce(_reward, case _difficulty when 'Easy' then 5 when 'Hard' then 20 else 10 end);

  select user_id into candidate from public.team_members
    where team_id = _team_id and job_title = primary_job and priority = 1
      and status = 'active' and is_active = true and member_status = 'active'
    limit 1;

  insert into public.tasks (
    team_id, creator_id, assignee_id, title, description, status, due_date,
    difficulty, reward, job_types, priority_index
  ) values (
    _team_id, auth.uid(), coalesce(candidate, auth.uid()), _title, _description,
    case when candidate is null then 'todo' else 'todo' end, _due_date,
    _difficulty, final_reward, _job_types, 1
  ) returning * into t;

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
end;
$$;

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
    update public.tasks set assignee_id = next_user, priority_index = priority_index + 1 where id = _task_id;
  else
    update public.tasks set assignee_id = t.creator_id, status = 'cancelled' where id = _task_id;
  end if;
end;
$$;

create or replace function public.task_submit(_task_id uuid, _type text, _content text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.tasks set status = 'under_review', submission_type = _type, submission_content = _content
    where id = _task_id and assignee_id = auth.uid() and status = 'in_progress';
$$;

create or replace function public.task_approve(_task_id uuid, _rating int)
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
  if not public.is_team_manager(t.team_id) then raise exception 'Not authorized'; end if;

  update public.tasks set status = 'done', rating = _rating, completed_at = now() where id = _task_id;
  update public.team_members set balance = balance + coalesce(t.reward, 0)
    where team_id = t.team_id and user_id = t.assignee_id;
  insert into public.transactions (team_id, sender_id, receiver_id, amount, details)
    values (t.team_id, null, t.assignee_id, coalesce(t.reward, 0), 'Task reward: ' || t.title);
end;
$$;

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
  if not public.is_team_manager(t.team_id) then raise exception 'Not authorized'; end if;

  update public.tasks set status = 'in_progress', description = description || E'\n\nRevision requested: ' || _notes
    where id = _task_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Loosen tasks_insert/update so managers can create/update via task_* RPCs
-- (SECURITY DEFINER bypasses RLS already, but keep direct-write policies for
-- fields the RPCs don't cover, e.g. edits from TasksSection today).
-- ---------------------------------------------------------------------------

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert to authenticated with check (
    creator_id = auth.uid() and public.is_team_manager(team_id)
  );

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated using (
    assignee_id = auth.uid() or public.is_team_manager(team_id)
  ) with check (
    assignee_id = auth.uid() or public.is_team_manager(team_id)
  );
