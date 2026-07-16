-- Real activity signal for the directory's "Most Active" sort, replacing the
-- member-count proxy. A trigger on team_messages inserts covers chat
-- activity; task_approve and team_check_in (already re-published in 0021 for
-- badges) get one more republish to also log a row, rather than adding a
-- second client-side call site.
create table if not exists public.team_activity_log (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  occurred_at timestamptz not null default now()
);

create index if not exists team_activity_log_team_recent_idx on public.team_activity_log (team_id, occurred_at desc);

alter table public.team_activity_log enable row level security;

drop policy if exists "team_activity_log_select_all" on public.team_activity_log;
create policy "team_activity_log_select_all" on public.team_activity_log
  for select to authenticated using (true);

create or replace function public.log_team_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.team_activity_log (team_id) values (new.team_id);
  return new;
end;
$$;

drop trigger if exists team_messages_activity on public.team_messages;
create trigger team_messages_activity
  after insert on public.team_messages
  for each row execute function public.log_team_activity();

-- Re-published once more with the activity-log insert added.
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
end;
$$;

-- Re-published once more with the activity-log insert added.
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

  return m;
end;
$$;

create or replace function public.get_team_activity_counts(_since timestamptz)
returns table (team_id uuid, activity_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select team_id, count(*) from public.team_activity_log
  where occurred_at >= _since
  group by team_id;
$$;

revoke all on function public.get_team_activity_counts(timestamptz) from public;
grant execute on function public.get_team_activity_counts(timestamptz) to authenticated;
