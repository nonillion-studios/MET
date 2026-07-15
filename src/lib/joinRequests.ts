import { supabase } from './supabaseClient';
import type { Team } from './teams';

export interface JoinRequest {
  id: string;
  team_id: string;
  user_id: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  user?: { name: string; email: string } | null;
}

export interface PublicTeamCard extends Team {
  member_count: number;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.rpc(fn, args);
  return error ? error.message : null;
}

export const requestToJoinTeam = (teamId: string, message: string) =>
  rpc('request_to_join_team', { _team_id: teamId, _message: message });

export const decideJoinRequest = (id: string, approve: boolean) =>
  rpc('decide_join_request', { _id: id, _approve: approve });

export async function listPublicTeams(): Promise<PublicTeamCard[]> {
  const { data: teams } = await supabase.from('teams').select('*').eq('visibility', 'public');
  if (!teams || teams.length === 0) return [];

  const counts = await Promise.all(
    (teams as Team[]).map(t =>
      supabase.from('team_members').select('id', { count: 'exact', head: true }).eq('team_id', t.id).eq('status', 'active')
    )
  );
  return (teams as Team[]).map((t, i) => ({ ...t, member_count: counts[i].count ?? 0 }));
}

export async function listPendingJoinRequests(teamId: string): Promise<JoinRequest[]> {
  const { data } = await supabase
    .from('join_requests')
    .select('*, user:profiles!join_requests_user_id_fkey(name, email)')
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return (data as unknown as JoinRequest[]) ?? [];
}
