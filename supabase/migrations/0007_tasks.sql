-- Teams stage 3: tasks + a per-team Telegram channel for attachments.
-- Run this once in the Supabase SQL editor for this project.

alter table public.teams add column if not exists telegram_channel_id text default '';

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text default '',
  status text not null default 'todo',
  due_date timestamptz,
  attachment_name text default '',
  attachment_size bigint default 0,
  attachment_msg_id bigint,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint tasks_status_check check (status in ('todo', 'done'))
);

alter table public.tasks enable row level security;

drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated using (
    assignee_id = auth.uid()
    or public.is_team_owner(team_id)
    or public.is_team_leader(team_id)
  );

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert to authenticated with check (
    creator_id = auth.uid()
    and (public.is_team_owner(team_id) or public.is_team_leader(team_id))
  );

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated using (
    assignee_id = auth.uid()
    or public.is_team_owner(team_id)
    or public.is_team_leader(team_id)
  ) with check (
    assignee_id = auth.uid()
    or public.is_team_owner(team_id)
    or public.is_team_leader(team_id)
  );

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete to authenticated using (
    public.is_team_owner(team_id) or public.is_team_leader(team_id)
  );

-- Let a leader (not just the owner/admin) set the team's Telegram channel.
drop policy if exists "teams_update_owner" on public.teams;
create policy "teams_update_owner" on public.teams
  for update to authenticated using (
    owner_id = auth.uid() or public.is_team_leader(id)
  ) with check (
    owner_id = auth.uid() or public.is_team_leader(id)
  );
