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
