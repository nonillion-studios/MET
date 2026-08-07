-- trigger_send_push() (0055, reworked in 0076) swallows every failure via
-- `exception when others then return new` with no trace at all — by design, a push failure
-- must never block the notification row itself, but "no trace anywhere" made every past bug in
-- this trigger (0053, 0076) invisible until someone went looking. `raise warning` keeps the
-- swallow-and-continue behavior (a warning doesn't abort the transaction) while putting the
-- actual error text in Postgres/Supabase's logs, so a future misconfiguration (stale VAPID keys,
-- a rotated edge_service_key, a broken edge_base_url) shows up instead of vanishing silently.

create or replace function public.trigger_send_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := public._edge_base_url() || '/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public._edge_service_key()
    ),
    body := jsonb_build_object('notification_id', new.id, 'user_id', new.user_id)
  );
  return new;
exception when others then
  raise warning 'trigger_send_push failed for notification %: % (%)', new.id, sqlerrm, sqlstate;
  return new;
end;
$$;
