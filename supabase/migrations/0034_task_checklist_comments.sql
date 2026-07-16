-- Subtasks/checklist items and a lightweight comment thread per task.
create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  label text not null,
  done boolean not null default false,
  position int not null default 0,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.task_checklist_items enable row level security;
alter table public.task_comments enable row level security;

-- Shared visibility rule: assignee, any active team member, or the owner.
drop policy if exists "task_checklist_items_select" on public.task_checklist_items;
create policy "task_checklist_items_select" on public.task_checklist_items
  for select to authenticated using (
    exists (
      select 1 from public.tasks t
      where t.id = task_checklist_items.task_id
        and (
          t.assignee_id = auth.uid()
          or exists (select 1 from public.team_members where team_id = t.team_id and user_id = auth.uid() and status = 'active')
          or exists (select 1 from public.teams where id = t.team_id and owner_id = auth.uid())
        )
    )
  );

drop policy if exists "task_checklist_items_write" on public.task_checklist_items;
create policy "task_checklist_items_write" on public.task_checklist_items
  for all to authenticated using (
    exists (
      select 1 from public.tasks t
      where t.id = task_checklist_items.task_id
        and (t.assignee_id = auth.uid() or public.is_team_manager(t.team_id))
    )
  ) with check (created_by = auth.uid());

drop policy if exists "task_comments_select" on public.task_comments;
create policy "task_comments_select" on public.task_comments
  for select to authenticated using (
    exists (
      select 1 from public.tasks t
      where t.id = task_comments.task_id
        and (
          t.assignee_id = auth.uid()
          or exists (select 1 from public.team_members where team_id = t.team_id and user_id = auth.uid() and status = 'active')
          or exists (select 1 from public.teams where id = t.team_id and owner_id = auth.uid())
        )
    )
  );

drop policy if exists "task_comments_insert" on public.task_comments;
create policy "task_comments_insert" on public.task_comments
  for insert to authenticated with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.tasks t
      where t.id = task_comments.task_id
        and (
          t.assignee_id = auth.uid()
          or exists (select 1 from public.team_members where team_id = t.team_id and user_id = auth.uid() and status = 'active')
          or exists (select 1 from public.teams where id = t.team_id and owner_id = auth.uid())
        )
    )
  );

alter publication supabase_realtime add table public.task_comments;
