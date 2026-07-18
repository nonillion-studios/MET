import { supabase } from './supabaseClient';

export interface TeamMemberJob {
  id: string;
  team_id: string;
  user_id: string;
  job_type: string;
  priority: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export async function listTeamMemberJobs(teamId: string): Promise<TeamMemberJob[]> {
  const { data } = await supabase.from('team_member_jobs').select().eq('team_id', teamId).order('job_type').order('priority');
  return (data as TeamMemberJob[]) ?? [];
}

export async function listMyJobs(teamId: string): Promise<TeamMemberJob[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];
  const { data } = await supabase.from('team_member_jobs').select().eq('team_id', teamId).eq('user_id', userId).order('job_type');
  return (data as TeamMemberJob[]) ?? [];
}

export async function claimJobPriority(teamId: string, jobType: string, requestedPriority: number): Promise<{ job: TeamMemberJob | null; error: string | null }> {
  const { data, error } = await supabase.rpc('claim_job_priority', { _team_id: teamId, _job_type: jobType, _requested: requestedPriority });
  return { job: error ? null : (data as TeamMemberJob), error: error ? error.message : null };
}

export async function removeMemberJob(teamId: string, jobType: string): Promise<string | null> {
  const { error } = await supabase.rpc('remove_member_job', { _team_id: teamId, _job_type: jobType });
  return error ? error.message : null;
}

export async function setMemberJobActive(teamId: string, jobType: string, active: boolean): Promise<string | null> {
  const { error } = await supabase.rpc('set_member_job_active', { _team_id: teamId, _job_type: jobType, _active: active });
  return error ? error.message : null;
}

export async function adminSetMemberJob(teamId: string, userId: string, jobType: string, requestedPriority: number): Promise<{ job: TeamMemberJob | null; error: string | null }> {
  const { data, error } = await supabase.rpc('admin_set_member_job', { _team_id: teamId, _user_id: userId, _job_type: jobType, _requested: requestedPriority });
  return { job: error ? null : (data as TeamMemberJob), error: error ? error.message : null };
}

export async function adminRemoveMemberJob(teamId: string, userId: string, jobType: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_remove_member_job', { _team_id: teamId, _user_id: userId, _job_type: jobType });
  return error ? error.message : null;
}
