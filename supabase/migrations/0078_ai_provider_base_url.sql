-- Lets OpenAI-compatible providers that need a custom endpoint (Ollama running locally/self-hosted,
-- an alternate OpenRouter/Groq region, a private gateway, etc.) store that endpoint. Plain,
-- non-sensitive column like model/provider already are — no key material involved.

alter table public.ai_credentials
  add column if not exists base_url text not null default '';
