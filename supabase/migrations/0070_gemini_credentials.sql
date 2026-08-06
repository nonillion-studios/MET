-- Stores each user's Gemini API key (for the Text Editor's AI translation
-- feature) plus their default translation prompt/target language, synced
-- across devices via Supabase. The API key is a reusable credential for the
-- user's own Gemini/Google AI account, so it's encrypted at rest the same
-- way the Telegram session string is (see 0006/0010/0045/0053): pgcrypto,
-- a per-user key derived from the user's email via HMAC against a secret
-- held in public.app_secrets (never in a migration file, never granted to
-- anon/authenticated), and reads/writes go through SECURITY DEFINER RPCs
-- rather than the table directly. The prompt/target language are not
-- sensitive and are stored as plain columns, like telegram_credentials'
-- api_id/phone/etc.

-- pgcrypto is already installed into the `extensions` schema on this project (Supabase's
-- default), so this `create extension if not exists` is a no-op rather than putting it in
-- `public` — every pgcrypto function call below is schema-qualified (or runs under a
-- `search_path` that includes `extensions`) to actually resolve against it. Confirmed live via
-- `select extnamespace::regnamespace from pg_extension where extname = 'pgcrypto'` -> extensions.
create extension if not exists pgcrypto;

create table if not exists public.ai_credentials (
  id uuid primary key references public.profiles(id) on delete cascade,
  gemini_key_encrypted bytea,
  default_prompt text not null default '',
  target_language text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.ai_credentials enable row level security;

drop policy if exists "ai_credentials_select_own" on public.ai_credentials;
create policy "ai_credentials_select_own" on public.ai_credentials
  for select to authenticated using (id = auth.uid());

drop policy if exists "ai_credentials_insert_own" on public.ai_credentials;
create policy "ai_credentials_insert_own" on public.ai_credentials
  for insert to authenticated with check (id = auth.uid());

drop policy if exists "ai_credentials_update_own" on public.ai_credentials;
create policy "ai_credentials_update_own" on public.ai_credentials
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "ai_credentials_delete_own" on public.ai_credentials;
create policy "ai_credentials_delete_own" on public.ai_credentials
  for delete to authenticated using (id = auth.uid());

-- Secret lives in the table-backed app_secrets store (see 0053's rationale:
-- `alter database ... set` isn't available to Supabase's managed role), a
-- table only SECURITY DEFINER functions can read. Own secret, independent
-- of telegram_enc_key, so rotating one never affects the other.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);

alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from public, anon, authenticated;

insert into public.app_secrets (key, value)
select 'gemini_enc_key', encode(extensions.gen_random_bytes(32), 'base64')
where not exists (select 1 from public.app_secrets where key = 'gemini_enc_key');

create or replace function public._gemini_enc_key()
returns text
language sql
security definer
set search_path = public
as $$
  select value from public.app_secrets where key = 'gemini_enc_key';
$$;

revoke all on function public._gemini_enc_key() from public, anon, authenticated;

-- Per-user derived key via HMAC(email, gemini_enc_key) — mirrors
-- _telegram_session_key so a single leaked secret alone isn't enough to
-- decrypt every user's key.
create or replace function public._gemini_session_key(p_user_id uuid)
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
  return encode(hmac(lower(v_email), public._gemini_enc_key(), 'sha256'), 'hex');
end;
$$;

revoke all on function public._gemini_session_key(uuid) from public;

-- Stores/replaces the caller's own encrypted Gemini key.
create or replace function public.rpc_set_gemini_key(p_key text)
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

  v_key := public._gemini_session_key(auth.uid());
  if v_key is null then
    raise exception 'Could not resolve encryption key for current user';
  end if;

  insert into public.ai_credentials (id, gemini_key_encrypted, updated_at)
  values (auth.uid(), pgp_sym_encrypt(p_key, v_key), now())
  on conflict (id) do update
    set gemini_key_encrypted = excluded.gemini_key_encrypted,
        updated_at = now();
end;
$$;

-- Decrypts and returns only the calling user's own Gemini key.
create or replace function public.rpc_get_gemini_key()
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

  select gemini_key_encrypted into v_enc
  from public.ai_credentials
  where id = auth.uid();

  if v_enc is null then
    return null;
  end if;

  v_key := public._gemini_session_key(auth.uid());
  if v_key is null then
    raise exception 'Could not resolve encryption key for current user';
  end if;

  return pgp_sym_decrypt(v_enc, v_key);
end;
$$;

revoke all on function public.rpc_set_gemini_key(text) from public;
revoke all on function public.rpc_get_gemini_key() from public;
grant execute on function public.rpc_set_gemini_key(text) to authenticated;
grant execute on function public.rpc_get_gemini_key() to authenticated;
