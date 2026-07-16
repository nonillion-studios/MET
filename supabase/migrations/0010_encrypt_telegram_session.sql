-- Encrypts the Telegram GramJS session string at rest. That string is a full,
-- reusable login credential for the user's Telegram account (equivalent to a
-- session cookie) — storing it as plaintext meant anyone with DB/table access
-- (a leaked service-role key, a misconfigured RLS policy, a DB dump) could
-- impersonate the user's Telegram account outright. RLS alone doesn't cover
-- that class of leak, so the value is now encrypted with pgcrypto, and the
-- encryption key lives only in a Postgres setting the client never sees —
-- reads/writes of the session go through SECURITY DEFINER RPCs instead of the
-- table directly.
--
-- IMPORTANT (manual step, run once per environment): before/after applying
-- this migration, set the encryption key as a database setting so it never
-- lives in a migration file or the client bundle:
--   alter database postgres set app.telegram_enc_key = '<a long random secret>';
-- Generate one with e.g. `openssl rand -base64 32`. Without this set, the
-- RPCs below will fail loudly rather than silently storing plaintext.

create extension if not exists pgcrypto;

alter table public.telegram_credentials
  add column if not exists session_encrypted bytea;

-- One-time backfill: encrypt any existing plaintext sessions, then drop the
-- plaintext column. Wrapped so it's a no-op if app.telegram_enc_key isn't
-- set yet in this environment (existing rows just stay unencrypted-empty
-- until the owning user re-authenticates, rather than failing the migration).
do $$
begin
  if current_setting('app.telegram_enc_key', true) is not null then
    update public.telegram_credentials
    set session_encrypted = pgp_sym_encrypt(session, current_setting('app.telegram_enc_key'))
    where session is not null and session <> '' and session_encrypted is null;
  end if;
exception when others then
  raise notice 'Skipping session backfill: %', sqlerrm;
end $$;

alter table public.telegram_credentials drop column if exists session;

-- Store/replace the caller's own encrypted session. SECURITY DEFINER so the
-- function (not the client) holds the privilege to read app.telegram_enc_key
-- and write session_encrypted; RLS on the table still blocks direct writes.
create or replace function public.rpc_set_telegram_session(p_session text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.telegram_credentials (id, session_encrypted, updated_at)
  values (auth.uid(), pgp_sym_encrypt(p_session, current_setting('app.telegram_enc_key')), now())
  on conflict (id) do update
    set session_encrypted = excluded.session_encrypted,
        updated_at = now();
end;
$$;

-- Decrypts and returns only the calling user's own session.
create or replace function public.rpc_get_telegram_session()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc bytea;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select session_encrypted into v_enc
  from public.telegram_credentials
  where id = auth.uid();

  if v_enc is null then
    return null;
  end if;

  return pgp_sym_decrypt(v_enc, current_setting('app.telegram_enc_key'));
end;
$$;

revoke all on function public.rpc_set_telegram_session(text) from public;
revoke all on function public.rpc_get_telegram_session() from public;
grant execute on function public.rpc_set_telegram_session(text) to authenticated;
grant execute on function public.rpc_get_telegram_session() to authenticated;
