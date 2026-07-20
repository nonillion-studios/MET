-- Restricts who may post/edit/delete Library announcements to a specific,
-- Supabase-editable list of emails, rather than the broader profiles.is_admin
-- flag. Add/remove a row in this table (via the Supabase table editor) to
-- grant/revoke sending rights — no code change or deploy needed.
create table if not exists public.admin_message_senders (
  email text primary key,
  created_at timestamptz not null default now()
);

insert into public.admin_message_senders (email)
values ('mhmdmyark0@gmail.com')
on conflict (email) do nothing;

alter table public.admin_message_senders enable row level security;

drop policy if exists "admin_message_senders_select_own" on public.admin_message_senders;
create policy "admin_message_senders_select_own" on public.admin_message_senders
  for select to authenticated using (
    email = auth.email()
  );

drop policy if exists "admin_messages_select_own_sender" on public.admin_messages;
create policy "admin_messages_select_own_sender" on public.admin_messages
  for select to authenticated using (
    exists (select 1 from public.admin_message_senders where email = auth.email())
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
  if not exists (select 1 from public.admin_message_senders where email = auth.email()) then
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
  if not exists (select 1 from public.admin_message_senders where email = auth.email()) then
    raise exception 'Not authorized';
  end if;
  delete from public.admin_messages where id = _id;
end;
$$;
