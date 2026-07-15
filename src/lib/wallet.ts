import { supabase } from './supabaseClient';

export interface Transaction {
  id: string;
  team_id: string;
  sender_id: string | null;
  receiver_id: string;
  amount: number;
  details: string;
  created_at: string;
  sender?: { name: string; email: string } | null;
  receiver?: { name: string; email: string } | null;
}

export interface Withdrawal {
  id: string;
  team_id: string;
  user_id: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  user?: { name: string; email: string } | null;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.rpc(fn, args);
  return error ? error.message : null;
}

export const deposit = (teamId: string, toUser: string, amount: number, details: string) =>
  rpc('wallet_deposit', { _team_id: teamId, _to_user: toUser, _amount: amount, _details: details });

export const penalize = (teamId: string, toUser: string, amount: number, details: string) =>
  rpc('wallet_penalize', { _team_id: teamId, _to_user: toUser, _amount: amount, _details: details });

export const transfer = (teamId: string, toUser: string, amount: number, details: string) =>
  rpc('wallet_transfer', { _team_id: teamId, _to_user: toUser, _amount: amount, _details: details });

export async function requestWithdrawal(teamId: string, amount: number): Promise<string | null> {
  const { error } = await supabase.rpc('wallet_request_withdrawal', { _team_id: teamId, _amount: amount });
  return error ? error.message : null;
}

export const decideWithdrawal = (id: string, approve: boolean) =>
  rpc('wallet_decide_withdrawal', { _id: id, _approve: approve });

export async function listPendingWithdrawals(teamId: string): Promise<Withdrawal[]> {
  const { data } = await supabase
    .from('withdrawals')
    .select('*, user:profiles!withdrawals_user_id_fkey(name, email)')
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return (data as unknown as Withdrawal[]) ?? [];
}

export async function listTransactions(teamId: string, userId?: string): Promise<Transaction[]> {
  let query = supabase
    .from('transactions')
    .select('*, sender:profiles!transactions_sender_id_fkey(name, email), receiver:profiles!transactions_receiver_id_fkey(name, email)')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (userId) query = query.or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
  const { data } = await query;
  return (data as unknown as Transaction[]) ?? [];
}
