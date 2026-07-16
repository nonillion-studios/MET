-- Reusable task templates, prefilled into the creation form client-side
-- rather than a server round-trip.
create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  title text not null,
  description text default '',
  job_types text[] not null default '{}',
  reward numeric,
  priority text not null default 'normal',
  tags text[] not null default '{}',
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.task_templates enable row level security;

drop policy if exists "task_templates_select_members" on public.task_templates;
create policy "task_templates_select_members" on public.task_templates
  for select to authenticated using (
    exists (select 1 from public.team_members where team_id = task_templates.team_id and user_id = auth.uid() and status = 'active')
    or exists (select 1 from public.teams where id = task_templates.team_id and owner_id = auth.uid())
  );

drop policy if exists "task_templates_write_managers" on public.task_templates;
create policy "task_templates_write_managers" on public.task_templates
  for all to authenticated using (
    public.is_team_manager(team_id) or public.team_member_has_perm(team_id, 'can_manage_tasks')
  ) with check (created_by = auth.uid());
