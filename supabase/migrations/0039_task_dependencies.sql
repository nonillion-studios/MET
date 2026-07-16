create table if not exists public.task_dependencies (
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

alter table public.task_dependencies enable row level security;

drop policy if exists "task_dependencies_select" on public.task_dependencies;
create policy "task_dependencies_select" on public.task_dependencies
  for select to authenticated using (
    exists (
      select 1 from public.tasks t
      where t.id = task_dependencies.task_id
        and (
          t.assignee_id = auth.uid()
          or exists (select 1 from public.team_members where team_id = t.team_id and user_id = auth.uid() and status = 'active')
          or exists (select 1 from public.teams where id = t.team_id and owner_id = auth.uid())
        )
    )
  );

drop policy if exists "task_dependencies_write_managers" on public.task_dependencies;
create policy "task_dependencies_write_managers" on public.task_dependencies
  for all to authenticated using (
    exists (
      select 1 from public.tasks t
      where t.id = task_dependencies.task_id
        and (public.is_team_manager(t.team_id) or public.team_member_has_perm(t.team_id, 'can_manage_tasks'))
    )
  );

-- Re-published (2nd time) to block accepting a task until every task it
-- depends on is done.
create or replace function public.task_accept(_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count int;
  blocking_count int;
  noun text;
begin
  select count(*) into active_count from public.tasks
    where assignee_id = auth.uid() and status = 'in_progress';
  if active_count >= 3 then raise exception 'You already have 3 tasks in progress'; end if;

  select count(*) into blocking_count
    from public.task_dependencies d
    join public.tasks dep on dep.id = d.depends_on_task_id
    where d.task_id = _task_id and dep.status <> 'done';
  if blocking_count > 0 then
    noun := case when blocking_count = 1 then 'dependency' else 'dependencies' end;
    raise exception 'This task is blocked by % unfinished %', blocking_count, noun;
  end if;

  update public.tasks set status = 'in_progress'
    where id = _task_id and assignee_id = auth.uid() and status = 'todo';
  insert into public.task_history (task_id, actor_id, event) values (_task_id, auth.uid(), 'accepted');
end;
$$;
