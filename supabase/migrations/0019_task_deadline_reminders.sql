-- Sends a one-time reminder notification for tasks due within 24 hours.
-- `reminder_sent` makes this idempotent so calling it repeatedly (it's
-- invoked opportunistically from the client, not a real cron) never spams.
alter table public.tasks
  add column if not exists reminder_sent boolean not null default false;

create or replace function public.notify_upcoming_task_deadlines(_team_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  sent int := 0;
begin
  for t in
    select * from public.tasks
    where team_id = _team_id
      and status in ('todo', 'in_progress')
      and due_date is not null
      and due_date < now() + interval '24 hours'
      and due_date > now()
      and reminder_sent = false
      and assignee_id is not null
  loop
    insert into public.notifications (user_id, title, body)
    values (t.assignee_id, 'Task due soon', format('"%s" is due within 24 hours.', t.title));
    update public.tasks set reminder_sent = true where id = t.id;
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

revoke all on function public.notify_upcoming_task_deadlines(uuid) from public;
grant execute on function public.notify_upcoming_task_deadlines(uuid) to authenticated;
