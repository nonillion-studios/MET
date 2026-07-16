-- Canned accept/decline messages so leaders aren't typing the same response
-- to every join request. decide_join_request gains an optional response body
-- override; when omitted it keeps the generic message from migration 0012.
create table if not exists public.team_response_templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  label text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.team_response_templates enable row level security;

drop policy if exists "team_response_templates_select_members" on public.team_response_templates;
create policy "team_response_templates_select_members" on public.team_response_templates
  for select to authenticated using (
    exists (select 1 from public.team_members where team_id = team_response_templates.team_id and user_id = auth.uid() and status = 'active')
  );

create or replace function public.upsert_response_template(_id uuid, _team_id uuid, _label text, _body text)
returns public.team_response_templates
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.team_response_templates;
begin
  if not public.team_member_has_perm(_team_id, 'can_manage_join_requests') then raise exception 'Not authorized'; end if;

  if _id is null then
    insert into public.team_response_templates (team_id, label, body) values (_team_id, _label, _body) returning * into row;
  else
    update public.team_response_templates set label = _label, body = _body where id = _id and team_id = _team_id returning * into row;
  end if;
  return row;
end;
$$;

create or replace function public.delete_response_template(_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
begin
  select team_id into t_id from public.team_response_templates where id = _id;
  if t_id is null then return; end if;
  if not public.team_member_has_perm(t_id, 'can_manage_join_requests') then raise exception 'Not authorized'; end if;
  delete from public.team_response_templates where id = _id;
end;
$$;

create or replace function public.decide_join_request(_id uuid, _approve boolean, _response_body text default null)
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
    values (r.user_id, 'Join request accepted', coalesce(_response_body, format('You''re now a member of %s.', coalesce(v_team_name, 'the team'))));
  else
    update public.join_requests set status = 'rejected' where id = _id;
    insert into public.notifications (user_id, title, body)
    values (r.user_id, 'Join request declined', coalesce(_response_body, format('Your request to join %s was declined.', coalesce(v_team_name, 'the team'))));
  end if;
end;
$$;

revoke all on function public.upsert_response_template(uuid, uuid, text, text) from public;
revoke all on function public.delete_response_template(uuid) from public;
grant execute on function public.upsert_response_template(uuid, uuid, text, text) to authenticated;
grant execute on function public.delete_response_template(uuid) to authenticated;
