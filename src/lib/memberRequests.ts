import { supabase } from './supabaseClient';

export interface LeaveRequest {
  id: string;
  team_id: string;
  user_id: string;
  reason: string;
  duration: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  user?: { name: string; email: string } | null;
}

export interface ResignationRequest {
  id: string;
  team_id: string;
  user_id: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  user?: { name: string; email: string } | null;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.rpc(fn, args);
  return error ? error.message : null;
}

export const requestLeave = (teamId: string, reason: string, duration: string) =>
  rpc('request_leave', { _team_id: teamId, _reason: reason, _duration: duration });

export const decideLeave = (id: string, approve: boolean) =>
  rpc('decide_leave', { _id: id, _approve: approve });

export const requestResignation = (teamId: string, reason: string) =>
  rpc('request_resignation', { _team_id: teamId, _reason: reason });

export const decideResignation = (id: string, approve: boolean) =>
  rpc('decide_resignation', { _id: id, _approve: approve });

export async function listPendingLeaveRequests(teamId: string): Promise<LeaveRequest[]> {
  const { data } = await supabase
    .from('leave_requests')
    .select('*, user:profiles!leave_requests_user_id_fkey(name, email)')
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return (data as unknown as LeaveRequest[]) ?? [];
}

export async function listPendingResignations(teamId: string): Promise<ResignationRequest[]> {
  const { data } = await supabase
    .from('resignation_requests')
    .select('*, user:profiles!resignation_requests_user_id_fkey(name, email)')
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return (data as unknown as ResignationRequest[]) ?? [];
}
