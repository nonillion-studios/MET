-- decide_join_request approved/rejected a request but never told the
-- requesting user — they'd only find out by re-opening the team directory.
-- Insert a notifications row on both outcomes so it surfaces in the topbar
-- (and, once subscribed via Realtime on the client, as a live/browser
-- notification too).
create or replace function public.decide_join_request(_id uuid, _approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.join_requests;
  v_team_name text;
begin
  select * into r from public.join_requests where id = _id and status = 'pending' for update;
  if not found then raise exception 'Request not found or already decided'; end if;
  if not public.team_member_has_perm(r.team_id, 'can_manage_join_requests') then raise exception 'Not authorized'; end if;

  select name into v_team_name from public.teams where id = r.team_id;

  if _approve then
    update public.join_requests set status = 'approved' where id = _id;
    if not exists (select 1 from public.team_members where team_id = r.team_id and user_id = r.user_id) then
      insert into public.team_members (team_id, user_id, invited_email, role, status)
      values (r.team_id, r.user_id, (select email from public.profiles where id = r.user_id), 'member', 'active');
    end if;
    insert into public.notifications (user_id, title, body)
    values (r.user_id, 'Join request accepted', format('You''re now a member of %s.', coalesce(v_team_name, 'the team')));
  else
    update public.join_requests set status = 'rejected' where id = _id;
    insert into public.notifications (user_id, title, body)
    values (r.user_id, 'Join request declined', format('Your request to join %s was declined.', coalesce(v_team_name, 'the team')));
  end if;
end;
$$;
