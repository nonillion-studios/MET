import { supabase } from './supabaseClient';

export interface SeasonLeaderboardRow {
  team_id: string;
  team_name: string;
  team_logo: string;
  tasks_done: number;
  activity_score: number;
  featured: boolean;
}

export async function getCurrentSeasonLeaderboard(): Promise<SeasonLeaderboardRow[]> {
  const { data } = await supabase.rpc('get_current_season_leaderboard');
  return (data as SeasonLeaderboardRow[]) ?? [];
}

export async function closeCurrentSeason(): Promise<string | null> {
  const { error } = await supabase.rpc('close_current_season');
  return error ? error.message : null;
}
