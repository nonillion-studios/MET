-- User-facing priority level (distinct from the internal priority_index
-- assignment-queue position) and free-form tags, matching the convention
-- already used for teams.tags (0015).
alter table public.tasks add column if not exists priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent'));
alter table public.tasks add column if not exists tags text[] not null default '{}';

-- Re-published (6th time) to accept the two new fields at creation time.
create or replace function public.task_create(
  _team_id uuid, _title text, _description text, _difficulty text,
  _job_types text[], _due_date timestamptz, _reward numeric default null,
  _attachment_msg_id int default null, _attachment_name text default null, _attachment_size int default null,
  _priority text default 'normal', _tags text[] default '{}'
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  primary_job text;
  candidate uuid;
  t public.tasks;
begin
  if not (public.is_team_manager(_team_id) or public.team_member_has_perm(_team_id, 'can_manage_tasks')) then
    raise exception 'Not authorized';
  end if;

  primary_job := _job_types[1];

  select user_id into candidate from public.team_members
    where team_id = _team_id and job_title = primary_job and priority = 1
      and status = 'active' and is_active = true and member_status = 'active'
    limit 1;

  insert into public.tasks (
    team_id, creator_id, assignee_id, title, description, status, due_date,
    difficulty, reward, job_types, priority_index, offer_expires_at,
    attachment_msg_id, attachment_name, attachment_size, priority, tags
  ) values (
    _team_id, auth.uid(), coalesce(candidate, auth.uid()), _title, _description,
    'todo', _due_date, _difficulty, _reward, _job_types, 1, now() + interval '48 hours',
    _attachment_msg_id, _attachment_name, _attachment_size, _priority, _tags
  ) returning * into t;

  return t;
end;
$$;
