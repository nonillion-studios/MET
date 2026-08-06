-- Enforce "a user can only be an active member of one team at a time" as a real DB invariant,
-- not just an app-level check at one entry point — migration 0059_multi_team_membership.sql
-- actually went the other way (added user_active_team to let a user be simultaneously active on
-- several teams and just track which one is "current"), which is the opposite of what's wanted
-- here. A BEFORE trigger on team_members covers every path a row can become active through
-- (decide_join_request's insert, acceptInvite's direct update, any future one) from one place,
-- rather than duplicating the check in each RPC/client call site.

create or replace function public.enforce_single_active_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' and new.user_id is not null then
    if exists (
      select 1 from public.team_members
      where user_id = new.user_id and status = 'active' and team_id <> new.team_id
        and id <> new.id
    ) then
      raise exception 'Already an active member of another team — leave that team before joining this one';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_single_active_team on public.team_members;
create trigger trg_single_active_team
  before insert or update on public.team_members
  for each row execute function public.enforce_single_active_team();

-- Real bug, not just a missing feature: decide_resignation (latest body in
-- 0056_kick_and_leave_notify.sql) sets member_status = 'resigned' and is_active = false but never
-- touches team_members.status, which stays 'active' — and getMyMembership() (teams.ts) filters on
-- status = 'active', not member_status, so a resigned member's own client kept treating them as
-- still in the team (and, combined with the trigger above, would have wrongly blocked them from
-- joining anywhere else). Reproduced in full since create or replace replaces the whole body.
create or replace function public.decide_resignation(_id uuid, _approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.resignation_requests;
  v_team_name text;
begin
  select * into r from public.resignation_requests where id = _id and status = 'pending' for update;
  if not found then raise exception 'Request not found or already decided'; end if;
  if not public.is_team_manager(r.team_id) then raise exception 'Not authorized'; end if;

  select name into v_team_name from public.teams where id = r.team_id;

  if _approve then
    update public.resignation_requests set status = 'approved' where id = _id;
    update public.team_members set status = 'pending', member_status = 'resigned', is_active = false where team_id = r.team_id and user_id = r.user_id;
    insert into public.notifications (user_id, title, body)
      values (r.user_id, 'You have left the team', format('Your resignation from %s was approved.', coalesce(v_team_name, 'the team')));
  else
    update public.resignation_requests set status = 'rejected' where id = _id;
    insert into public.notifications (user_id, title, body)
      values (r.user_id, 'Resignation request declined', format('Your request to leave %s was declined.', coalesce(v_team_name, 'the team')));
  end if;
end;
$$;
