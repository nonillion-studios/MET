-- 0010/0045 encrypt the Telegram session server-side using a database-level
-- setting (app.telegram_enc_key) that was meant to be set once via
-- `alter database ... set app.telegram_enc_key = ...`. That statement
-- requires a role privilege Supabase's managed project role doesn't have
-- ("permission denied to set parameter"), so the key could never actually be
-- set this way — every call to rpc_set_telegram_session/rpc_get_telegram_session
-- raised, and the client silently degraded to storing the session in
-- localStorage only. Store the key in a table instead: it lives in the
-- public schema (required to exist reliably) but is never granted to
-- anon/authenticated, so only the SECURITY DEFINER RPCs below (which run as
-- the owning role and always have full owner access regardless of grants)
-- can ever read it.
create extension if not exists pgcrypto;

create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);

alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from public, anon, authenticated;

insert into public.app_secrets (key, value)
select 'telegram_enc_key', encode(gen_random_bytes(32), 'base64')
where not exists (select 1 from public.app_secrets where key = 'telegram_enc_key');

create or replace function public._telegram_enc_key()
returns text
language sql
security definer
set search_path = public
as $$
  select value from public.app_secrets where key = 'telegram_enc_key';
$$;

revoke all on function public._telegram_enc_key() from public, anon, authenticated;

-- Re-point the per-user key derivation (0045) at the table-backed secret
-- instead of the GUC that could never be set.
create or replace function public._telegram_session_key(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = p_user_id;
  if v_email is null then
    return null;
  end if;
  return encode(hmac(lower(v_email), public._telegram_enc_key(), 'sha256'), 'hex');
end;
$$;

revoke all on function public._telegram_session_key(uuid) from public;
