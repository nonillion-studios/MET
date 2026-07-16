import { supabase } from './supabaseClient';

export interface TeamBadge {
  id: string;
  team_id: string;
  code: string;
  label: string;
  awarded_at: string;
}

export async function listTeamBadges(teamId: string): Promise<TeamBadge[]> {
  const { data } = await supabase.from('team_badges').select('*').eq('team_id', teamId).order('awarded_at', { ascending: true });
  return (data as TeamBadge[]) ?? [];
}

export interface MemberBadge {
  id: string;
  team_id: string;
  user_id: string;
  code: string;
  label: string;
  awarded_at: string;
}

export async function listMemberBadges(teamId: string, userId: string): Promise<MemberBadge[]> {
  const { data } = await supabase.from('member_badges').select('*').eq('team_id', teamId).eq('user_id', userId).order('awarded_at', { ascending: true });
  return (data as MemberBadge[]) ?? [];
}

/** All badges for every member of a team, grouped by user_id — avoids N+1 queries in a message list. */
export async function listMemberBadgesForTeam(teamId: string): Promise<Map<string, MemberBadge[]>> {
  const { data } = await supabase.from('member_badges').select('*').eq('team_id', teamId).order('awarded_at', { ascending: true });
  const byUser = new Map<string, MemberBadge[]>();
  for (const row of (data as MemberBadge[]) ?? []) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }
  return byUser;
}
