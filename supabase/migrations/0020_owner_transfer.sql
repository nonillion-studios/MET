-- Team ownership had no handoff path — deleting/recreating was the only way
-- to change owner_id. This adds a nominate-then-accept flow so ownership
-- can't be silently reassigned without the new owner's consent.
create table if not exists public.owner_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);

alter table public.owner_transfer_requests enable row level security;

drop policy if exists "owner_transfer_select_involved" on public.owner_transfer_requests;
create policy "owner_transfer_select_involved" on public.owner_transfer_requests
  for select to authenticated using (from_user = auth.uid() or to_user = auth.uid());

create or replace function public.request_owner_transfer(_team_id uuid, _to_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.teams where id = _team_id and owner_id = auth.uid()) then
    raise exception 'Only the current owner can request a transfer';
  end if;
  update public.owner_transfer_requests set status = 'declined'
  where team_id = _team_id and status = 'pending';
  insert into public.owner_transfer_requests (team_id, from_user, to_user)
  values (_team_id, auth.uid(), _to_user);
  insert into public.notifications (user_id, title, body)
  values (_to_user, 'Ownership transfer offered', 'You''ve been offered ownership of a team. Review it in Teams.');
end;
$$;

create or replace function public.decide_owner_transfer(_id uuid, _accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.owner_transfer_requests;
begin
  select * into r from public.owner_transfer_requests where id = _id and status = 'pending' for update;
  if not found then raise exception 'Request not found or already decided'; end if;
  if r.to_user <> auth.uid() then raise exception 'Not authorized'; end if;

  if _accept then
    update public.owner_transfer_requests set status = 'accepted' where id = _id;
    update public.teams set owner_id = r.to_user where id = r.team_id;
    if not exists (select 1 from public.team_members where team_id = r.team_id and user_id = r.to_user) then
      insert into public.team_members (team_id, user_id, invited_email, role, status)
      values (r.team_id, r.to_user, (select email from public.profiles where id = r.to_user), 'leader', 'active');
    else
      update public.team_members set role = 'leader' where team_id = r.team_id and user_id = r.to_user;
    end if;
    insert into public.notifications (user_id, title, body)
    values (r.from_user, 'Ownership transferred', 'Your team ownership transfer was accepted.');
  else
    update public.owner_transfer_requests set status = 'declined' where id = _id;
    insert into public.notifications (user_id, title, body)
    values (r.from_user, 'Ownership transfer declined', 'The proposed new owner declined the transfer.');
  end if;
end;
$$;

revoke all on function public.request_owner_transfer(uuid, uuid) from public;
revoke all on function public.decide_owner_transfer(uuid, boolean) from public;
grant execute on function public.request_owner_transfer(uuid, uuid) to authenticated;
grant execute on function public.decide_owner_transfer(uuid, boolean) to authenticated;
