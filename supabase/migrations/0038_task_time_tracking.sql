create table if not exists public.task_time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Only one open (ended_at is null) entry per user at a time.
create unique index if not exists task_time_entries_one_open_per_user on public.task_time_entries (user_id) where ended_at is null;

alter table public.task_time_entries enable row level security;

drop policy if exists "task_time_entries_select" on public.task_time_entries;
create policy "task_time_entries_select" on public.task_time_entries
  for select to authenticated using (
    exists (
      select 1 from public.tasks t
      where t.id = task_time_entries.task_id
        and (
          t.assignee_id = auth.uid()
          or exists (select 1 from public.team_members where team_id = t.team_id and user_id = auth.uid() and status = 'active')
          or exists (select 1 from public.teams where id = t.team_id and owner_id = auth.uid())
        )
    )
  );

drop policy if exists "task_time_entries_write_own" on public.task_time_entries;
create policy "task_time_entries_write_own" on public.task_time_entries
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
