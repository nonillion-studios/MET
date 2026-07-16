-- team_badges (0021) is team-wide and has no user_id, so it can't express
-- "this specific person earned X" — needed for chat member profiles/badges.
-- This adds a parallel per-member table and award hooks alongside the
-- existing team-wide ones (task_approve/team_check_in already award a
-- team badge; they now also award personal milestone badges).
create table if not exists public.member_badges (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  label text not null,
  awarded_at timestamptz not null default now(),
  unique (team_id, user_id, code)
);

alter table public.member_badges enable row level security;

drop policy if exists "member_badges_select_all" on public.member_badges;
create policy "member_badges_select_all" on public.member_badges
  for select to authenticated using (true);

create or replace function public.award_member_badge_if_missing(_team_id uuid, _user_id uuid, _code text, _label text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.member_badges (team_id, user_id, code, label)
  values (_team_id, _user_id, _code, _label)
  on conflict (team_id, user_id, code) do nothing;
end;
$$;

revoke all on function public.award_member_badge_if_missing(uuid, uuid, text, text) from public;
grant execute on function public.award_member_badge_if_missing(uuid, uuid, text, text) to authenticated;

-- Re-published (4th time) with personal task-completion milestone badges added.
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

-- Re-published (6th time) with a personal streak badge added.
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
  insert into public.team_activity_log (team_id) values (_team_id);

  if new_streak >= 30 then
    perform public.award_badge_if_missing(_team_id, 'streak-30', '30-Day Streak');
  end if;
  if new_streak >= 7 then
    perform public.award_member_badge_if_missing(_team_id, auth.uid(), 'streak-7', '7-Day Streak');
  end if;
  if new_streak >= 30 then
    perform public.award_member_badge_if_missing(_team_id, auth.uid(), 'streak-30', '30-Day Streak');
  end if;
  if new_streak >= 100 then
    perform public.award_member_badge_if_missing(_team_id, auth.uid(), 'streak-100', '100-Day Streak');
  end if;

  return m;
end;
$$;

-- Chat-veteran badge (100 messages sent): awarded server-side from a trigger
-- rather than a client call, so it can't be spoofed by skipping an award RPC.
create or replace function public.award_chat_veteran_badge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msg_count int;
begin
  select count(*) into msg_count from public.team_messages where team_id = new.team_id and sender_id = new.sender_id;
  if msg_count >= 100 then
    perform public.award_member_badge_if_missing(new.team_id, new.sender_id, 'chat-veteran', 'Chat Veteran');
  end if;
  return new;
end;
$$;

drop trigger if exists team_messages_chat_veteran on public.team_messages;
create trigger team_messages_chat_veteran
  after insert on public.team_messages
  for each row execute function public.award_chat_veteran_badge();
