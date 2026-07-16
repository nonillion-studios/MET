-- Tracks each member's own last-read point in team chat, used only to
-- compute their own unread count (not others' read receipts — a full
-- per-recipient seen-by model doesn't exist anywhere in this app's chat
-- design and is a much bigger feature, deliberately out of scope here).
create table if not exists public.team_chat_read_state (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_message_id uuid,
  updated_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

alter table public.team_chat_read_state enable row level security;

drop policy if exists "team_chat_read_state_own" on public.team_chat_read_state;
create policy "team_chat_read_state_own" on public.team_chat_read_state
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
