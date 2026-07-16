-- Pending join requests sat forever until a leader acted on them. This mirrors
-- expire_stale_task_offers's shape: a safe-to-call-anytime RPC (not a real
-- cron, since none exists in this project) invoked opportunistically from the
-- client when the directory/requests panel loads.
create or replace function public.expire_stale_join_requests(_team_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  moved int;
begin
  update public.join_requests
  set status = 'rejected'
  where team_id = _team_id and status = 'pending' and created_at < now() - interval '14 days';
  get diagnostics moved = row_count;
  return moved;
end;
$$;

revoke all on function public.expire_stale_join_requests(uuid) from public;
grant execute on function public.expire_stale_join_requests(uuid) to authenticated;
