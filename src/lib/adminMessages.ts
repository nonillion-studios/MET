import { supabase } from './supabaseClient';

export interface AdminMessage {
  id: string;
  author_id: string;
  body: string;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}

export async function listActiveAdminMessages(): Promise<AdminMessage[]> {
  const { data, error } = await supabase
    .from('admin_messages')
    .select()
    .eq('active', true)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data as AdminMessage[]) ?? [];
}

export async function listAllAdminMessages(): Promise<AdminMessage[]> {
  const { data, error } = await supabase
    .from('admin_messages')
    .select()
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data as AdminMessage[]) ?? [];
}

export async function upsertAdminMessage(input: {
  id?: string | null;
  body: string;
  active: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}): Promise<string | null> {
  const { error } = await supabase.rpc('upsert_admin_message', {
    _id: input.id ?? null,
    _body: input.body,
    _active: input.active,
    _starts_at: input.startsAt ?? null,
    _ends_at: input.endsAt ?? null,
  });
  return error ? error.message : null;
}

export async function deleteAdminMessage(id: string): Promise<string | null> {
  const { error } = await supabase.rpc('delete_admin_message', { _id: id });
  return error ? error.message : null;
}
