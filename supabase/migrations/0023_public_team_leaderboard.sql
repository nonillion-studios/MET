-- Cross-team leaderboard for the public directory — aggregates only public
-- teams' completed-task counts and total member balance, security definer so
-- it can read across teams without exposing anything about private teams.
create or replace function public.get_public_team_leaderboard()
returns table (team_id uuid, team_name text, team_logo text, tasks_done bigint, total_balance numeric)
language sql
security definer
set search_path = public
stable
as $$
  select
    t.id,
    t.name,
    t.logo,
    coalesce(task_counts.done_count, 0) as tasks_done,
    coalesce(balance_totals.total, 0) as total_balance
  from public.teams t
  left join (
    select team_id, count(*) as done_count
    from public.tasks
    where status = 'done'
    group by team_id
  ) task_counts on task_counts.team_id = t.id
  left join (
    select team_id, sum(balance) as total
    from public.team_members
    where status = 'active'
    group by team_id
  ) balance_totals on balance_totals.team_id = t.id
  where t.visibility = 'public'
  order by tasks_done desc, total_balance desc
  limit 50;
$$;

revoke all on function public.get_public_team_leaderboard() from public;
grant execute on function public.get_public_team_leaderboard() to authenticated;
