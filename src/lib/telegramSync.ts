import { supabase } from './supabaseClient';

export interface TelegramCredentials {
  apiId: string;
  apiHash: string;
  phone: string;
  session: string;
  chatId: string;
}

export async function loadTelegramCredentials(): Promise<TelegramCredentials | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;
  const { data } = await supabase
    .from('telegram_credentials')
    .select('api_id, api_hash, phone, chat_id')
    .eq('id', userId)
    .maybeSingle();
  if (!data) return null;

  // Session is stored encrypted server-side (pgcrypto) and only ever
  // decrypted inside the SECURITY DEFINER RPC — never as a plain table column.
  const { data: session } = await supabase.rpc('rpc_get_telegram_session');

  return {
    apiId: data.api_id || '',
    apiHash: data.api_hash || '',
    phone: data.phone || '',
    session: session || '',
    chatId: data.chat_id || '',
  };
}

export async function saveTelegramCredentials(partial: Partial<TelegramCredentials>): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  if (partial.session !== undefined) {
    await supabase.rpc('rpc_set_telegram_session', { p_session: partial.session });
  }

  const row: Record<string, string> = {};
  if (partial.apiId !== undefined) row.api_id = partial.apiId;
  if (partial.apiHash !== undefined) row.api_hash = partial.apiHash;
  if (partial.phone !== undefined) row.phone = partial.phone;
  if (partial.chatId !== undefined) row.chat_id = partial.chatId;
  if (Object.keys(row).length > 0) {
    await supabase.from('telegram_credentials').upsert({ id: userId, ...row });
  }
}
