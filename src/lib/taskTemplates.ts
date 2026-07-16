import { supabase } from './supabaseClient';
import type { TaskPriority } from './tasks';

export interface TaskTemplate {
  id: string;
  team_id: string;
  name: string;
  title: string;
  description: string;
  job_types: string[];
  reward: number | null;
  priority: TaskPriority;
  tags: string[];
  created_by: string;
  created_at: string;
}

export async function listTemplates(teamId: string): Promise<TaskTemplate[]> {
  const { data } = await supabase.from('task_templates').select('*').eq('team_id', teamId).order('created_at', { ascending: false });
  return (data as TaskTemplate[]) ?? [];
}

export async function saveAsTemplate(input: {
  teamId: string; name: string; title: string; description: string;
  jobTypes: string[]; reward: number | null; priority: TaskPriority; tags: string[];
}): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return 'Not signed in.';
  const { error } = await supabase.from('task_templates').insert({
    team_id: input.teamId, name: input.name, title: input.title, description: input.description,
    job_types: input.jobTypes, reward: input.reward, priority: input.priority, tags: input.tags, created_by: userId,
  });
  return error ? error.message : null;
}

export async function deleteTemplate(id: string): Promise<string | null> {
  const { error } = await supabase.from('task_templates').delete().eq('id', id);
  return error ? error.message : null;
}
