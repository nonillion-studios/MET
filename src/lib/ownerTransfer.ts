import { supabase } from './supabaseClient';

export interface OwnerTransferRequest {
  id: string;
  team_id: string;
  from_user: string;
  to_user: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  team?: { name: string } | null;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.rpc(fn, args);
  return error ? error.message : null;
}

export const requestOwnerTransfer = (teamId: string, toUser: string) =>
  rpc('request_owner_transfer', { _team_id: teamId, _to_user: toUser });

export const decideOwnerTransfer = (id: string, accept: boolean) =>
  rpc('decide_owner_transfer', { _id: id, _accept: accept });

export async function getMyPendingOwnerTransfers(): Promise<OwnerTransferRequest[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];
  const { data } = await supabase
    .from('owner_transfer_requests')
    .select('*, team:teams(name)')
    .eq('to_user', userId)
    .eq('status', 'pending');
  return (data as unknown as OwnerTransferRequest[]) ?? [];
}
