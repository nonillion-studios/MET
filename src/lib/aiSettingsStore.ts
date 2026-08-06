import { supabase } from './supabaseClient';
import type { AiProvider } from './aiTranslate';

export interface AiTranslationSettings {
  provider: AiProvider;
  /** The API key for whichever provider is currently selected — switching providers means
   *  re-entering a key for the new one (see the migration's own comment on why there's only one
   *  encrypted key slot rather than one per provider). */
  apiKey: string;
  model: string;
  defaultPrompt: string;
  targetLanguage: string;
}

const VALID_PROVIDERS: AiProvider[] = ['gemini', 'openai', 'anthropic'];

export async function loadAiTranslationSettings(): Promise<AiTranslationSettings | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;

  const { data } = await supabase
    .from('ai_credentials')
    .select('default_prompt, target_language, provider, model')
    .eq('id', userId)
    .maybeSingle();

  // Key is stored encrypted server-side (pgcrypto) and only ever decrypted
  // inside the SECURITY DEFINER RPC — never as a plain table column.
  const { data: apiKey } = await supabase.rpc('rpc_get_gemini_key');

  const provider = data?.provider as AiProvider | undefined;

  return {
    provider: provider && VALID_PROVIDERS.includes(provider) ? provider : 'gemini',
    apiKey: apiKey || '',
    model: data?.model || '',
    defaultPrompt: data?.default_prompt || '',
    targetLanguage: data?.target_language || '',
  };
}

export async function saveAiTranslationSettings(partial: Partial<AiTranslationSettings>): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  if (partial.apiKey !== undefined) {
    await supabase.rpc('rpc_set_gemini_key', { p_key: partial.apiKey });
  }

  const row: Record<string, string> = {};
  if (partial.defaultPrompt !== undefined) row.default_prompt = partial.defaultPrompt;
  if (partial.targetLanguage !== undefined) row.target_language = partial.targetLanguage;
  if (partial.provider !== undefined) row.provider = partial.provider;
  if (partial.model !== undefined) row.model = partial.model;
  if (Object.keys(row).length > 0) {
    await supabase.from('ai_credentials').upsert({ id: userId, ...row });
  }
}
