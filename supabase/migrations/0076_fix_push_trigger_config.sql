-- Another real, live bug found while deploying: trigger_send_push() (0055_push_subscriptions.sql)
-- reads app.settings.edge_base_url / app.settings.edge_service_key via current_setting(), which
-- were meant to be set once via `alter database ... set` — the exact same approach 0053 already
-- found doesn't work on Supabase's managed project role ("permission denied to set parameter"),
-- confirmed live again here with the identical error for these two settings. Since that GUC route
-- was never actually reachable, current_setting(..., true) has always silently returned NULL, so
-- every net.http_post call has had a NULL url and failed inside the trigger's own
-- `exception when others then return new` — meaning no push notification has ever actually been
-- sent by this trigger. Same fix as 0053: move the values into the table-backed app_secrets store
-- (already exists) instead of a GUC.
--
-- edge_base_url is public information (a project's Functions URL is not a secret — it's the same
-- host anyone's browser already calls), so it's fine to insert as a literal here, matching how a
-- project ref itself isn't treated as sensitive elsewhere in this schema. edge_service_key here is
-- the anon key rather than the true service-role key: the Edge Functions gateway only needs a
-- validly-signed Supabase JWT to let the call through (confirmed live — the anon key passes the
-- gateway and reaches send-push's own handler); the function does its actual privileged work with
-- SUPABASE_SERVICE_ROLE_KEY from its own environment, not from this header. Using anon here means
-- this literal is safe to ship in a migration file at all, unlike a real service-role key.

insert into public.app_secrets (key, value)
values
  ('edge_base_url', 'https://hglrjuibmiabelvqpshi.supabase.co/functions/v1'),
  ('edge_service_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnbHJqdWlibWlhYmVsdnFwc2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NTg4NTEsImV4cCI6MjA5OTQzNDg1MX0.1QXdxFZ9lVS0bkEuo7494BGaYC74ZMVE2ulebIMzWd8')
on conflict (key) do update set value = excluded.value;

create or replace function public._edge_base_url()
returns text
language sql
security definer
set search_path = public
as $$
  select value from public.app_secrets where key = 'edge_base_url';
$$;

create or replace function public._edge_service_key()
returns text
language sql
security definer
set search_path = public
as $$
  select value from public.app_secrets where key = 'edge_service_key';
$$;

revoke all on function public._edge_base_url() from public, anon, authenticated;
revoke all on function public._edge_service_key() from public, anon, authenticated;

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
  -- Push delivery is best-effort — a misconfigured/unreachable Edge Function must never
  -- block the notification row itself from being written.
  return new;
end;
$$;
