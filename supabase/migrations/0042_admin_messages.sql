-- App-wide announcement banner shown above the Library ad slot. Written by
-- global admins (profiles.is_admin), read by any authenticated user while
-- active and within its optional time window.
create table if not exists public.admin_messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.admin_messages enable row level security;

drop policy if exists "admin_messages_select_active" on public.admin_messages;
create policy "admin_messages_select_active" on public.admin_messages
  for select to authenticated using (
    active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

drop policy if exists "admin_messages_select_own_admin" on public.admin_messages;
create policy "admin_messages_select_own_admin" on public.admin_messages
  for select to authenticated using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin)
  );

create or replace function public.upsert_admin_message(_id uuid, _body text, _active boolean, _starts_at timestamptz, _ends_at timestamptz)
returns public.admin_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.admin_messages;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Not authorized';
  end if;

  if _id is null then
    insert into public.admin_messages (author_id, body, active, starts_at, ends_at)
    values (auth.uid(), _body, _active, _starts_at, _ends_at)
    returning * into row;
  else
    update public.admin_messages
    set body = _body, active = _active, starts_at = _starts_at, ends_at = _ends_at
    where id = _id
    returning * into row;
  end if;
  return row;
end;
$$;

create or replace function public.delete_admin_message(_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Not authorized';
  end if;
  delete from public.admin_messages where id = _id;
end;
$$;

revoke all on function public.upsert_admin_message(uuid, text, boolean, timestamptz, timestamptz) from public;
revoke all on function public.delete_admin_message(uuid) from public;
grant execute on function public.upsert_admin_message(uuid, text, boolean, timestamptz, timestamptz) to authenticated;
grant execute on function public.delete_admin_message(uuid) to authenticated;
