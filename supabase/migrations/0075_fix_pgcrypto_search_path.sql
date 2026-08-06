-- Real, live bug found while deploying: pgcrypto is installed in the `extensions` schema on
-- this project (Supabase's default), not `public`. Every SECURITY DEFINER function below pins
-- `search_path = public` and calls a pgcrypto function (hmac/pgp_sym_encrypt/pgp_sym_decrypt)
-- unqualified — confirmed live via `set search_path = public; select hmac(...)` failing with
-- "function hmac(unknown, unknown, unknown) does not exist", and succeeding once `extensions` is
-- added to the search_path. This means rpc_set_telegram_session/rpc_get_telegram_session (the
-- actual server-side storage for the Telegram MTProto session string) have been failing on every
-- call on this database — the direct, concrete cause of "the Telegram session doesn't store on
-- server": saveTelegramCredentials's try/catch (src/lib/telegramSync.ts) swallows the RPC error
-- and the client silently falls back to localStorage-only, exactly matching the reported symptom.
-- Reproduced in full since create or replace replaces the whole body.

create or replace function public._telegram_session_key(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
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

create or replace function public.rpc_set_telegram_session(p_session text)
returns void
language plpgsql
security definer
set search_path = public, extensions
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
set search_path = public, extensions
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
