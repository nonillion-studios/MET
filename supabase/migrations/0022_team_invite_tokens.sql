-- Shareable invite links as an alternative to pasting a raw team-ID UUID.
-- redeem_invite_token creates a join request the same way requestToJoinTeam
-- does (so approve/reject still goes through the existing decide_join_request
-- flow) rather than auto-joining, keeping leader approval in the loop.
create table if not exists public.team_invite_tokens (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(9), 'base64'),
  expires_at timestamptz,
  uses_left int,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.team_invite_tokens enable row level security;

drop policy if exists "team_invite_tokens_select_owner" on public.team_invite_tokens;
create policy "team_invite_tokens_select_owner" on public.team_invite_tokens
  for select to authenticated using (
    exists (select 1 from public.teams where id = team_id and owner_id = auth.uid())
  );

create or replace function public.create_invite_token(_team_id uuid, _expires_in_days int default null, _max_uses int default null)
returns public.team_invite_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.team_invite_tokens;
begin
  if not exists (select 1 from public.teams where id = _team_id and owner_id = auth.uid()) then
    raise exception 'Only the team owner can create invite links';
  end if;
  insert into public.team_invite_tokens (team_id, expires_at, uses_left, created_by)
  values (
    _team_id,
    case when _expires_in_days is not null then now() + (_expires_in_days || ' days')::interval else null end,
    _max_uses,
    auth.uid()
  )
  returning * into row;
  return row;
end;
$$;

create or replace function public.redeem_invite_token(_token text, _message text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.team_invite_tokens;
  req_id uuid;
begin
  select * into inv from public.team_invite_tokens where token = _token for update;
  if not found then raise exception 'Invalid invite link'; end if;
  if inv.expires_at is not null and inv.expires_at < now() then raise exception 'This invite link has expired'; end if;
  if inv.uses_left is not null and inv.uses_left <= 0 then raise exception 'This invite link has been fully used'; end if;

  insert into public.join_requests (team_id, user_id, message)
  values (inv.team_id, auth.uid(), _message)
  returning id into req_id;

  if inv.uses_left is not null then
    update public.team_invite_tokens set uses_left = uses_left - 1 where id = inv.id;
  end if;
  return req_id;
end;
$$;

revoke all on function public.create_invite_token(uuid, int, int) from public;
revoke all on function public.redeem_invite_token(text, text) from public;
grant execute on function public.create_invite_token(uuid, int, int) to authenticated;
grant execute on function public.redeem_invite_token(text, text) to authenticated;
