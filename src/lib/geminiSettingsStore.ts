import { supabase } from './supabaseClient';

export interface AiTranslationSettings {
  geminiKey: string;
  defaultPrompt: string;
  targetLanguage: string;
}

export async function loadAiTranslationSettings(): Promise<AiTranslationSettings | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;

  const { data } = await supabase
    .from('ai_credentials')
    .select('default_prompt, target_language')
    .eq('id', userId)
    .maybeSingle();

  // Key is stored encrypted server-side (pgcrypto) and only ever decrypted
  // inside the SECURITY DEFINER RPC — never as a plain table column.
  const { data: geminiKey } = await supabase.rpc('rpc_get_gemini_key');

  return {
    geminiKey: geminiKey || '',
    defaultPrompt: data?.default_prompt || '',
    targetLanguage: data?.target_language || '',
  };
}

export async function saveAiTranslationSettings(partial: Partial<AiTranslationSettings>): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  if (partial.geminiKey !== undefined) {
    await supabase.rpc('rpc_set_gemini_key', { p_key: partial.geminiKey });
  }

  const row: Record<string, string> = {};
  if (partial.defaultPrompt !== undefined) row.default_prompt = partial.defaultPrompt;
  if (partial.targetLanguage !== undefined) row.target_language = partial.targetLanguage;
  if (Object.keys(row).length > 0) {
    await supabase.from('ai_credentials').upsert({ id: userId, ...row });
  }
}
