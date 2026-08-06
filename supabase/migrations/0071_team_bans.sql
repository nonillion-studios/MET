-- Ban a member from a team, distinct from kick_team_member (0056): a kick just removes someone
-- (status back to 'pending', member_status 'resigned') but leaves them free to immediately
-- request_to_join_team again — a ban additionally blocks that self-serve rejoin path until an
-- owner/leader explicitly lifts it. team_members.status has a hard check(status in ('pending',
-- 'active')), so this rides on a separate boolean rather than trying to encode a third status value.

alter table public.team_members add column if not exists is_banned boolean not null default false;
alter table public.team_members add column if not exists banned_reason text;
alter table public.team_members add column if not exists banned_at timestamptz;

create or replace function public.ban_team_member(_team_id uuid, _user_id uuid, _reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_name text;
begin
  if not (public.is_team_owner(_team_id) or public.team_member_has_perm(_team_id, 'can_manage_members')) then
    raise exception 'Not authorized';
  end if;
  if _user_id = (select owner_id from public.teams where id = _team_id) then
    raise exception 'Cannot ban the team owner';
  end if;

  select name into v_team_name from public.teams where id = _team_id;

  update public.team_members
    set status = 'pending', is_active = false, member_status = 'resigned',
        is_banned = true, banned_reason = _reason, banned_at = now()
    where team_id = _team_id and user_id = _user_id;

  insert into public.notifications (user_id, title, body)
    values (_user_id, 'Banned from team', format('You were banned from %s.%s', coalesce(v_team_name, 'the team'), case when _reason is not null then ' Reason: ' || _reason else '' end));
end;
$$;

create or replace function public.unban_team_member(_team_id uuid, _user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_team_owner(_team_id) or public.team_member_has_perm(_team_id, 'can_manage_members')) then
    raise exception 'Not authorized';
  end if;

  update public.team_members
    set is_banned = false, banned_reason = null, banned_at = null
    where team_id = _team_id and user_id = _user_id;
end;
$$;

-- request_to_join_team (latest body from 0060_join_request_jobs.sql) reproduced in full with the
-- ban check added — create or replace replaces the whole body, same reason every other migration
-- in this schema that touches an existing function reproduces it rather than patching in place.
create or replace function public.request_to_join_team(_team_id uuid, _message text, _job_types text[] default '{}')
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
  if exists (select 1 from public.team_members where team_id = _team_id and user_id = auth.uid() and is_banned) then
    raise exception 'You have been banned from this team';
  end if;

  insert into public.join_requests (team_id, user_id, message, job_types)
  values (_team_id, auth.uid(), _message, _job_types)
  returning * into r;
  return r;
end;
$$;
