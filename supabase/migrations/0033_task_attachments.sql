-- The single attachment_msg_id/name/size triple on `tasks` was shared
-- between the creator's reference file (attached at creation) and the
-- assignee's submission file — the second upload silently clobbered the
-- first. This adds a proper multi-row attachments table; the old columns
-- stay untouched for backward compatibility with existing tasks but new
-- uploads (creation-time reference + submission) go here instead, tagged
-- by kind.
create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  msg_id bigint not null,
  name text not null,
  size bigint not null default 0,
  kind text not null check (kind in ('reference', 'submission')),
  created_at timestamptz not null default now()
);

alter table public.task_attachments enable row level security;

drop policy if exists "task_attachments_select_team" on public.task_attachments;
create policy "task_attachments_select_team" on public.task_attachments
  for select to authenticated using (
    exists (
      select 1 from public.tasks t
      where t.id = task_attachments.task_id
        and (
          t.assignee_id = auth.uid()
          or exists (select 1 from public.team_members where team_id = t.team_id and user_id = auth.uid() and status = 'active')
          or exists (select 1 from public.teams where id = t.team_id and owner_id = auth.uid())
        )
    )
  );

drop policy if exists "task_attachments_insert_own" on public.task_attachments;
create policy "task_attachments_insert_own" on public.task_attachments
  for insert to authenticated with check (uploader_id = auth.uid());
