-- Lets the AI Translation feature target more than just Gemini. `provider` selects which vision
-- API translatePageImage (src/lib/aiTranslate.ts) calls, `model` is that provider's model id
-- (e.g. "gemini-2.0-flash", "gpt-4o", "claude-sonnet-4-20250514") — both plain, non-sensitive
-- columns like default_prompt/target_language already are. The existing encrypted key column
-- (gemini_key_encrypted, rpc_set_gemini_key/rpc_get_gemini_key) is deliberately left as-is and
-- reused for whichever provider is currently selected, rather than adding one encrypted column
-- per provider — this app only ever calls one active provider at a time, so a single key slot
-- that follows the provider dropdown matches the actual usage pattern without extra schema.

alter table public.ai_credentials
  add column if not exists provider text not null default 'gemini',
  add column if not exists model text not null default '';
