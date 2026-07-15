-- Teams stage 5: public/private team directory + join requests, sub-admin
-- permissions, in-app team chat + DMs (Realtime), lazy task-offer expiry,
-- and removal of the automatic difficulty->reward payout.
-- Run this once in the Supabase SQL editor for this project.

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------

alter table public.teams add column if not exists description text default '';
alter table public.teams add column if not exists visibility text not null default 'private';
alter table public.teams add column if not exists pay_note text default '';

do $$ begin
  alter table public.teams add constraint teams_visibility_check
    check (visibility in ('public', 'private'));
exception when duplicate_object then null; end $$;

alter table public.team_members add column if not exists can_review_tasks boolean not null default false;
alter table public.team_members add column if not exists can_manage_bank boolean not null default false;
alter table public.team_members add column if not exists can_manage_join_requests boolean not null default false;
alter table public.team_members add column if not exists can_manage_vacations boolean not null default false;

alter table public.tasks add column if not exists offer_expires_at timestamptz;

-- Public teams are discoverable by anyone signed in; private teams stay
-- limited to owner/active-member visibility (existing 0004 policy already
-- covers that half).
drop policy if exists "teams_select_public" on public.teams;
create policy "teams_select_public" on public.teams
  for select to authenticated using (visibility = 'public');

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text default '',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint join_requests_status_check check (status in ('pending', 'approved', 'rejected'))
);

alter table public.join_requests enable row level security;

drop policy if exists "join_requests_select" on public.join_requests;
create policy "join_requests_select" on public.join_requests
  for select to authenticated using (
    user_id = auth.uid() or public.is_team_owner(team_id) or public.is_team_leader(team_id)
  );

create table if not exists public.team_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.team_messages enable row level security;
alter table public.direct_messages enable row level security;

drop policy if exists "team_messages_select" on public.team_messages;
create policy "team_messages_select" on public.team_messages
  for select to authenticated using (public.is_team_active_member(team_id) or public.is_team_owner(team_id));

drop policy if exists "team_messages_insert" on public.team_messages;
create policy "team_messages_insert" on public.team_messages
  for insert to authenticated with check (
    sender_id = auth.uid() and (public.is_team_active_member(team_id) or public.is_team_owner(team_id))
  );

drop policy if exists "direct_messages_select" on public.direct_messages;
create policy "direct_messages_select" on public.direct_messages
  for select to authenticated using (
    (sender_id = auth.uid() or receiver_id = auth.uid())
    and (public.is_team_active_member(team_id) or public.is_team_owner(team_id))
  );

drop policy if exists "direct_messages_insert" on public.direct_messages;
create policy "direct_messages_insert" on public.direct_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and (public.is_team_active_member(team_id) or public.is_team_owner(team_id))
  );

drop policy if exists "direct_messages_update" on public.direct_messages;
create policy "direct_messages_update" on public.direct_messages
  for update to authenticated using (receiver_id = auth.uid()) with check (receiver_id = auth.uid());

alter publication supabase_realtime add table public.team_messages;
alter publication supabase_realtime add table public.direct_messages;
alter table public.team_messages replica identity full;
alter table public.direct_messages replica identity full;

-- ---------------------------------------------------------------------------
-- Permission helper (owner = everything; leader = only what they're granted)
-- ---------------------------------------------------------------------------

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
        else false
      end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Join requests
-- ---------------------------------------------------------------------------

create or replace function public.request_to_join_team(_team_id uuid, _message text)
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.join_requests;
begin
  if not exists (select 1 from public.teams where id = _team_id) then
    raise exception 'Team not found';
  end if;
  if exists (select 1 from public.team_members where team_id = _team_id and user_id = auth.uid() and status = 'active') then
    raise exception 'Already a member of this team';
  end if;

  insert into public.join_requests (team_id, user_id, message)
  values (_team_id, auth.uid(), _message)
  returning * into r;
  return r;
end;
$$;

create or replace function public.decide_join_request(_id uuid, _approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.join_requests;
begin
  select * into r from public.join_requests where id = _id and status = 'pending' for update;
  if not found then raise exception 'Request not found or already decided'; end if;
  if not public.team_member_has_perm(r.team_id, 'can_manage_join_requests') then raise exception 'Not authorized'; end if;

  if _approve then
    update public.join_requests set status = 'approved' where id = _id;
    if not exists (select 1 from public.team_members where team_id = r.team_id and user_id = r.user_id) then
      insert into public.team_members (team_id, user_id, invited_email, role, status)
      values (r.team_id, r.user_id, (select email from public.profiles where id = r.user_id), 'member', 'active');
    end if;
  else
    update public.join_requests set status = 'rejected' where id = _id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Re-gate existing manager-only RPCs onto the 4-permission model
-- ---------------------------------------------------------------------------

create or replace function public.wallet_deposit(_team_id uuid, _to_user uuid, _amount numeric, _details text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.team_member_has_perm(_team_id, 'can_manage_bank') then raise exception 'Not authorized'; end if;
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
  if not public.team_member_has_perm(_team_id, 'can_manage_bank') then raise exception 'Not authorized'; end if;
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;

  update public.team_members set balance = balance - _amount where team_id = _team_id and user_id = _to_user;
  insert into public.transactions (team_id, sender_id, receiver_id, amount, details)
    values (_team_id, null, _to_user, -_amount, _details);
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
  if not public.team_member_has_perm(w.team_id, 'can_manage_bank') then raise exception 'Not authorized'; end if;

  if _approve then
    update public.withdrawals set status = 'approved' where id = _id;
  else
    update public.withdrawals set status = 'rejected' where id = _id;
    update public.team_members set balance = balance + w.amount where team_id = w.team_id and user_id = w.user_id;
  end if;
end;
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
  if not public.team_member_has_perm(t.team_id, 'can_review_tasks') then raise exception 'Not authorized'; end if;

  update public.tasks set status = 'done', rating = _rating, completed_at = now() where id = _task_id;

  if t.reward is not null and t.reward > 0 then
    update public.team_members set balance = balance + t.reward
      where team_id = t.team_id and user_id = t.assignee_id;
    insert into public.transactions (team_id, sender_id, receiver_id, amount, details)
      values (t.team_id, null, t.assignee_id, t.reward, 'Task reward: ' || t.title);
  end if;
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
  if not public.team_member_has_perm(t.team_id, 'can_review_tasks') then raise exception 'Not authorized'; end if;

  update public.tasks set status = 'in_progress', description = description || E'\n\nRevision requested: ' || _notes
    where id = _task_id;
end;
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
  if not public.team_member_has_perm(r.team_id, 'can_manage_vacations') then raise exception 'Not authorized'; end if;

  if _approve then
    update public.leave_requests set status = 'approved' where id = _id;
    update public.team_members set member_status = 'on_leave' where team_id = r.team_id and user_id = r.user_id;
  else
    update public.leave_requests set status = 'rejected' where id = _id;
  end if;
end;
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
  if not public.team_member_has_perm(r.team_id, 'can_manage_vacations') then raise exception 'Not authorized'; end if;

  if _approve then
    update public.resignation_requests set status = 'approved' where id = _id;
    update public.team_members set member_status = 'resigned', is_active = false where team_id = r.team_id and user_id = r.user_id;
  else
    update public.resignation_requests set status = 'rejected' where id = _id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Task creation: no more auto reward; add offer expiry
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
  t public.tasks;
begin
  if not public.is_team_manager(_team_id) then raise exception 'Not authorized'; end if;

  primary_job := _job_types[1];

  select user_id into candidate from public.team_members
    where team_id = _team_id and job_title = primary_job and priority = 1
      and status = 'active' and is_active = true and member_status = 'active'
    limit 1;

  insert into public.tasks (
    team_id, creator_id, assignee_id, title, description, status, due_date,
    difficulty, reward, job_types, priority_index, offer_expires_at
  ) values (
    _team_id, auth.uid(), coalesce(candidate, auth.uid()), _title, _description,
    'todo', _due_date, _difficulty, _reward, _job_types, 1, now() + interval '48 hours'
  ) returning * into t;

  return t;
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
    update public.tasks set assignee_id = next_user, priority_index = priority_index + 1, offer_expires_at = now() + interval '48 hours'
      where id = _task_id;
  else
    update public.tasks set assignee_id = t.creator_id, status = 'cancelled' where id = _task_id;
  end if;
end;
$$;

create or replace function public.expire_stale_task_offers(_team_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  primary_job text;
  next_user uuid;
  moved int := 0;
begin
  for t in
    select * from public.tasks
    where team_id = _team_id and status = 'todo' and offer_expires_at is not null and offer_expires_at < now()
  loop
    primary_job := t.job_types[1];
    next_user := public.team_next_priority_candidate(_team_id, primary_job, t.priority_index, t.assignee_id);

    if next_user is not null then
      update public.tasks set assignee_id = next_user, priority_index = t.priority_index + 1, offer_expires_at = now() + interval '48 hours'
        where id = t.id;
    else
      update public.tasks set assignee_id = t.creator_id, status = 'cancelled' where id = t.id;
    end if;
    moved := moved + 1;
  end loop;

  return moved;
end;
$$;
