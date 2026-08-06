-- A member's own confirmation that they've joined their team's Telegram channel — prompted before
-- they can preview Team Cloud files, since TeamFilesSection reads the channel through *their own*
-- connected Telegram client (cc.fetchChannelFiles), which silently returns nothing/errors if their
-- account was never actually added to that channel. There was no UI nudging them to join it by ID
-- at all before this.

alter table public.team_members add column if not exists telegram_channel_confirmed boolean not null default false;

-- team_members_update (0050) only lets an already-active member's own row be touched by an
-- owner/manager, not the member themself (its self-row branch is scoped to status='pending', i.e.
-- accepting an invite) — so this needs its own narrowly-scoped RPC rather than a raw client update.
create or replace function public.confirm_telegram_channel_joined(_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_members
    set telegram_channel_confirmed = true
    where team_id = _team_id and user_id = auth.uid();
end;
$$;
