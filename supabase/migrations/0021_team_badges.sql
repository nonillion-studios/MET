-- Awards a small set of milestone badges (100 tasks completed, 30-day streak)
-- automatically, wired directly into the existing task_approve/team_check_in
-- RPC bodies rather than a separate client-side poller — the milestone is
-- only ever crossed inside those two functions anyway.
create table if not exists public.team_badges (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  code text not null,
  label text not null,
  awarded_at timestamptz not null default now(),
  unique (team_id, code)
);

alter table public.team_badges enable row level security;

drop policy if exists "team_badges_select_all" on public.team_badges;
create policy "team_badges_select_all" on public.team_badges
  for select to authenticated using (true);

create or replace function public.award_badge_if_missing(_team_id uuid, _code text, _label text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.team_badges (team_id, code, label)
  values (_team_id, _code, _label)
  on conflict (team_id, code) do nothing;
end;
$$;

revoke all on function public.award_badge_if_missing(uuid, text, text) from public;
grant execute on function public.award_badge_if_missing(uuid, text, text) to authenticated;

-- Re-published with the badge-award hook added after the reward payout.
create or replace function public.task_approve(_task_id uuid, _rating int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tasks;
  done_count int;
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

  select count(*) into done_count from public.tasks where team_id = t.team_id and status = 'done';
  if done_count >= 100 then
    perform public.award_badge_if_missing(t.team_id, 'tasks-100', '100 Tasks Completed');
  end if;
end;
$$;

-- Re-published with the badge-award hook added after the streak update.
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

  if new_streak >= 30 then
    perform public.award_badge_if_missing(_team_id, 'streak-30', '30-Day Streak');
  end if;

  return m;
end;
$$;
