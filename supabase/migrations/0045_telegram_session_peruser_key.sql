-- Strengthens Telegram session encryption (see 0010_encrypt_telegram_session.sql)
-- from one shared DB-wide key to a per-user key derived from the user's email.
-- Previously every user's session was encrypted with the same
-- app.telegram_enc_key, so a single leaked secret could decrypt any user's
-- session. Deriving a per-user key via HMAC(email, app.telegram_enc_key)
-- means the shared secret alone is no longer sufficient — an attacker would
-- also need each user's email (which they'd typically already have if they
-- have DB access, so this is defense-in-depth via key separation, not a
-- substitute for protecting app.telegram_enc_key itself).

create extension if not exists pgcrypto;

-- Returns the per-user derived key for the calling user (or NULL if the
-- user's email can't be resolved). Not exposed to the client — only used
-- internally by the two RPCs below.
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
  return encode(hmac(lower(v_email), current_setting('app.telegram_enc_key'), 'sha256'), 'hex');
end;
$$;

revoke all on function public._telegram_session_key(uuid) from public;

create or replace function public.rpc_set_telegram_session(p_session text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_key := public._telegram_session_key(auth.uid());
  if v_key is null then
    raise exception 'Could not resolve encryption key for current user';
  end if;

  insert into public.telegram_credentials (id, session_encrypted, updated_at)
  values (auth.uid(), pgp_sym_encrypt(p_session, v_key), now())
  on conflict (id) do update
    set session_encrypted = excluded.session_encrypted,
        updated_at = now();
end;
$$;

create or replace function public.rpc_get_telegram_session()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc bytea;
  v_key text;
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

  v_key := public._telegram_session_key(auth.uid());
  if v_key is null then
    raise exception 'Could not resolve encryption key for current user';
  end if;

  return pgp_sym_decrypt(v_enc, v_key);
end;
$$;

revoke all on function public.rpc_set_telegram_session(text) from public;
revoke all on function public.rpc_get_telegram_session() from public;
grant execute on function public.rpc_set_telegram_session(text) to authenticated;
grant execute on function public.rpc_get_telegram_session() to authenticated;

-- One-time backfill: re-encrypt any existing sessions (encrypted under the
-- old shared-secret scheme) with the new per-user derived key. This is only
-- safe to attempt automatically because the *old* scheme also used
-- app.telegram_enc_key directly as the pgp_sym key, so we can decrypt with
-- it here and re-encrypt with the new per-user key in the same statement.
-- If app.telegram_enc_key isn't set in this environment, or any row fails to
-- decrypt (e.g. it was already migrated, or the key was rotated since),
-- this block skips silently rather than failing the whole migration —
-- affected users simply get re-encrypted next time they call
-- rpc_set_telegram_session (e.g. on their next login/saveConfig).
do $$
declare
  r record;
  v_key text;
  v_plain text;
begin
  if current_setting('app.telegram_enc_key', true) is null then
    return;
  end if;
  for r in select id, session_encrypted from public.telegram_credentials where session_encrypted is not null loop
    begin
      v_plain := pgp_sym_decrypt(r.session_encrypted, current_setting('app.telegram_enc_key'));
      v_key := public._telegram_session_key(r.id);
      if v_key is not null then
        update public.telegram_credentials
        set session_encrypted = pgp_sym_encrypt(v_plain, v_key)
        where id = r.id;
      end if;
    exception when others then
      raise notice 'Skipping per-user re-encryption for %: %', r.id, sqlerrm;
    end;
  end loop;
end $$;
