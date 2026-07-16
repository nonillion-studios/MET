-- Premium chat: reactions, replies, edit/delete, and pinned messages.
-- Bundled into one migration since they all touch the same two tables
-- (team_messages/direct_messages) plus one new shared reactions table.

-- Reactions -------------------------------------------------------------
-- A single table with a message_table discriminator (instead of two
-- separate reaction tables) keeps client code/realtime subscription unified.
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  message_table text not null check (message_table in ('team_messages', 'direct_messages')),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

alter table public.message_reactions enable row level security;

drop policy if exists "message_reactions_select_members" on public.message_reactions;
create policy "message_reactions_select_members" on public.message_reactions
  for select to authenticated using (
    exists (select 1 from public.team_members where team_id = message_reactions.team_id and user_id = auth.uid() and status = 'active')
    or exists (select 1 from public.teams where id = message_reactions.team_id and owner_id = auth.uid())
  );

drop policy if exists "message_reactions_insert_own" on public.message_reactions;
create policy "message_reactions_insert_own" on public.message_reactions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "message_reactions_delete_own" on public.message_reactions;
create policy "message_reactions_delete_own" on public.message_reactions
  for delete to authenticated using (user_id = auth.uid());

alter publication supabase_realtime add table public.message_reactions;

-- Replies -----------------------------------------------------------------
alter table public.team_messages add column if not exists reply_to_id uuid references public.team_messages(id);
alter table public.direct_messages add column if not exists reply_to_id uuid references public.direct_messages(id);

-- Edit / delete -------------------------------------------------------------
alter table public.team_messages add column if not exists edited_at timestamptz;
alter table public.team_messages add column if not exists deleted boolean not null default false;
alter table public.direct_messages add column if not exists edited_at timestamptz;
alter table public.direct_messages add column if not exists deleted boolean not null default false;

drop policy if exists "team_messages_update_own" on public.team_messages;
create policy "team_messages_update_own" on public.team_messages
  for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());

drop policy if exists "direct_messages_update_own" on public.direct_messages;
create policy "direct_messages_update_own" on public.direct_messages
  for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- Pinned (team chat only) ----------------------------------------------------
alter table public.team_messages add column if not exists pinned boolean not null default false;

-- Leaders/owner can also update (pin) any message in their team, not just
-- their own — a second, additive update policy (Postgres OR's multiple
-- permissive policies together).
drop policy if exists "team_messages_update_managers_pin" on public.team_messages;
create policy "team_messages_update_managers_pin" on public.team_messages
  for update to authenticated using (
    exists (select 1 from public.team_members where team_id = team_messages.team_id and user_id = auth.uid() and role = 'leader' and status = 'active')
    or exists (select 1 from public.teams where id = team_messages.team_id and owner_id = auth.uid())
  );

-- Attachments -----------------------------------------------------------
alter table public.team_messages add column if not exists attachment_msg_id bigint;
alter table public.team_messages add column if not exists attachment_name text;
alter table public.team_messages add column if not exists attachment_size bigint;
alter table public.direct_messages add column if not exists attachment_msg_id bigint;
alter table public.direct_messages add column if not exists attachment_name text;
alter table public.direct_messages add column if not exists attachment_size bigint;
