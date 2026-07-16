-- Legendary feature: time-boxed competitive seasons. Ties together the
-- leaderboard (0023), activity log (0024), and badges (0021) into a
-- recurring cycle instead of a static all-time ranking. Scope is
-- intentionally realistic: no automated real-money payouts — "rewards" are a
-- badge plus a featured-placement flag. Rollover is triggered manually by an
-- admin button (this project has no server-side cron), not on a real timer.
create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now()
);

create unique index if not exists seasons_one_active_idx on public.seasons ((true)) where status = 'active';

create table if not exists public.season_team_stats (
  season_id uuid not null references public.seasons(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  tasks_done bigint not null default 0,
  activity_score bigint not null default 0,
  final_rank int,
  featured boolean not null default false,
  primary key (season_id, team_id)
);

alter table public.seasons enable row level security;
alter table public.season_team_stats enable row level security;

drop policy if exists "seasons_select_all" on public.seasons;
create policy "seasons_select_all" on public.seasons for select to authenticated using (true);

drop policy if exists "season_team_stats_select_all" on public.season_team_stats;
create policy "season_team_stats_select_all" on public.season_team_stats for select to authenticated using (true);

-- Ensures a season row exists; called lazily by the client rather than
-- requiring a separate admin bootstrap step.
create or replace function public.ensure_active_season()
returns public.seasons
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.seasons;
begin
  select * into s from public.seasons where status = 'active' limit 1;
  if not found then
    insert into public.seasons (starts_at) values (now()) returning * into s;
  end if;
  return s;
end;
$$;

create or replace function public.get_current_season_leaderboard()
returns table (team_id uuid, team_name text, team_logo text, tasks_done bigint, activity_score bigint, featured boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.seasons;
begin
  s := public.ensure_active_season();
  return query
    select
      t.id,
      t.name,
      t.logo,
      coalesce((select count(*) from public.tasks where team_id = t.id and status = 'done' and completed_at >= s.starts_at), 0),
      coalesce((select count(*) from public.team_activity_log where team_id = t.id and occurred_at >= s.starts_at), 0),
      coalesce((select featured from public.season_team_stats where season_id = s.id and team_id = t.id), false)
    from public.teams t
    where t.visibility = 'public'
    order by 4 desc, 5 desc
    limit 50;
end;
$$;

-- Admin-triggered rollover: snapshots final standings for the active season,
-- closes it, awards a champion badge + featured flag to the top team, and
-- opens the next season.
create or replace function public.close_current_season()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.seasons;
  rank_row record;
  rnk int := 0;
  champion_team uuid;
  season_num int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Only an app admin can close a season';
  end if;

  select * into s from public.seasons where status = 'active' for update;
  if not found then raise exception 'No active season'; end if;

  for rank_row in
    select
      t.id as team_id,
      coalesce((select count(*) from public.tasks where team_id = t.id and status = 'done' and completed_at >= s.starts_at), 0) as tasks_done,
      coalesce((select count(*) from public.team_activity_log where team_id = t.id and occurred_at >= s.starts_at), 0) as activity_score
    from public.teams t
    where t.visibility = 'public'
    order by tasks_done desc, activity_score desc
  loop
    rnk := rnk + 1;
    insert into public.season_team_stats (season_id, team_id, tasks_done, activity_score, final_rank, featured)
    values (s.id, rank_row.team_id, rank_row.tasks_done, rank_row.activity_score, rnk, rnk = 1)
    on conflict (season_id, team_id) do update
      set tasks_done = excluded.tasks_done, activity_score = excluded.activity_score, final_rank = excluded.final_rank, featured = excluded.featured;
    if rnk = 1 then champion_team := rank_row.team_id; end if;
  end loop;

  select count(*) into season_num from public.seasons where status = 'closed';
  season_num := season_num + 1;

  if champion_team is not null then
    perform public.award_badge_if_missing(champion_team, 'season-champion-' || season_num, 'Season ' || season_num || ' Champion');
  end if;

  update public.seasons set status = 'closed', ends_at = now() where id = s.id;
  insert into public.seasons (starts_at) values (now());
end;
$$;

revoke all on function public.ensure_active_season() from public;
revoke all on function public.get_current_season_leaderboard() from public;
revoke all on function public.close_current_season() from public;
grant execute on function public.ensure_active_season() to authenticated;
grant execute on function public.get_current_season_leaderboard() to authenticated;
grant execute on function public.close_current_season() to authenticated;
