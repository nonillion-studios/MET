-- Fix "infinite recursion detected in policy for relation teams".
-- Root cause: team_members_select subqueries team_members from within its own
-- policy (self-recursion), and teams/team_members policies cross-subquery each
-- other (a second cycle). SECURITY DEFINER helper functions bypass RLS on the
-- underlying tables (they run as the owning role), which breaks both cycles.
-- Run this once in the Supabase SQL editor for this project.

create or replace function public.is_team_owner(_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.teams t where t.id = _team_id and t.owner_id = auth.uid());
$$;

create or replace function public.is_team_active_member(_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = _team_id and tm.user_id = auth.uid() and tm.status = 'active'
  );
$$;

create or replace function public.is_team_leader(_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = _team_id and tm.user_id = auth.uid() and tm.status = 'active' and tm.role = 'leader'
  );
$$;

-- teams: SELECT
drop policy if exists "teams_select_member_or_owner" on public.teams;
create policy "teams_select_member_or_owner" on public.teams
  for select to authenticated using (
    owner_id = auth.uid() or public.is_team_active_member(id)
  );

-- team_members: SELECT (drops the recursive self-subquery entirely)
drop policy if exists "team_members_select" on public.team_members;
create policy "team_members_select" on public.team_members
  for select to authenticated using (
    user_id = auth.uid()
    or invited_email = auth.jwt()->>'email'
    or public.is_team_owner(team_id)
    or public.is_team_active_member(team_id)
  );

-- team_members: INSERT (owner or leader)
drop policy if exists "team_members_insert_owner_only" on public.team_members;
drop policy if exists "team_members_insert_owner_or_leader" on public.team_members;
create policy "team_members_insert_owner_or_leader" on public.team_members
  for insert to authenticated with check (
    public.is_team_owner(team_id) or public.is_team_leader(team_id)
  );

-- team_members: UPDATE (owner promotes/demotes; invitee accepts own pending invite)
drop policy if exists "team_members_update" on public.team_members;
create policy "team_members_update" on public.team_members
  for update to authenticated using (
    (invited_email = auth.jwt()->>'email' and status = 'pending')
    or public.is_team_owner(team_id)
  ) with check (
    (invited_email = auth.jwt()->>'email' and user_id = auth.uid())
    or public.is_team_owner(team_id)
  );

-- team_members: DELETE (invitee declines own invite; owner or leader removes)
drop policy if exists "team_members_delete" on public.team_members;
create policy "team_members_delete" on public.team_members
  for delete to authenticated using (
    invited_email = auth.jwt()->>'email'
    or public.is_team_owner(team_id)
    or public.is_team_leader(team_id)
  );
