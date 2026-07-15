import { supabase } from './supabaseClient';
import { notify } from './notifications';

export type TaskDifficulty = 'Easy' | 'Medium' | 'Hard';
export type TaskStatus = 'todo' | 'in_progress' | 'under_review' | 'done' | 'cancelled';

export interface Task {
  id: string;
  team_id: string;
  creator_id: string;
  assignee_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  due_date: string | null;
  attachment_name: string;
  attachment_size: number;
  attachment_msg_id: number | null;
  created_at: string;
  completed_at: string | null;
  difficulty: TaskDifficulty;
  reward: number | null;
  job_types: string[];
  submission_type: 'file' | 'link' | null;
  submission_content: string | null;
  rating: number | null;
  priority_index: number;
  assignee?: { name: string; avatar: string; email: string } | null;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.rpc(fn, args);
  return error ? error.message : null;
}

export async function createTaskWithWorkflow(input: {
  teamId: string; title: string; description: string; difficulty: TaskDifficulty;
  jobTypes: string[]; dueDate: string | null; reward?: number;
}): Promise<string | null> {
  const { data, error } = await supabase.rpc('task_create', {
    _team_id: input.teamId, _title: input.title, _description: input.description,
    _difficulty: input.difficulty, _job_types: input.jobTypes, _due_date: input.dueDate,
    _reward: input.reward ?? null,
  });
  if (error) return error.message;
  const created = data as Task | null;
  if (created?.assignee_id) await notify(created.assignee_id, 'New task assigned', input.title);
  return null;
}

export const acceptTask = (taskId: string) => rpc('task_accept', { _task_id: taskId });
export const declineTask = (taskId: string) => rpc('task_decline', { _task_id: taskId });
export const submitTask = (taskId: string, type: 'file' | 'link', content: string) =>
  rpc('task_submit', { _task_id: taskId, _type: type, _content: content });
export const approveTask = (taskId: string, rating: number) =>
  rpc('task_approve', { _task_id: taskId, _rating: rating });
export const rejectSubmission = (taskId: string, notes: string) =>
  rpc('task_reject_submission', { _task_id: taskId, _notes: notes });
export const checkIn = (teamId: string) => rpc('team_check_in', { _team_id: teamId });
export const setMemberActive = (teamId: string, isActive: boolean) =>
  rpc('team_set_active', { _team_id: teamId, _is_active: isActive });
export const changePriority = (teamId: string, requested: number) =>
  rpc('team_change_priority', { _team_id: teamId, _requested: requested });

export async function expireStaleOffers(teamId: string): Promise<void> {
  await supabase.rpc('expire_stale_task_offers', { _team_id: teamId });
}

export async function listTeamTasks(teamId: string): Promise<Task[]> {
  const { data } = await supabase
    .from('tasks')
    .select('*, assignee:profiles!tasks_assignee_id_fkey(name, avatar, email)')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false });
  return (data as unknown as Task[]) ?? [];
}

export async function listMyTasks(teamId: string): Promise<Task[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];
  const { data } = await supabase
    .from('tasks')
    .select('*')
    .eq('team_id', teamId)
    .eq('assignee_id', userId)
    .order('created_at', { ascending: false });
  return (data as Task[]) ?? [];
}

export async function deleteTask(taskId: string): Promise<string | null> {
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  return error ? error.message : null;
}

export async function attachFileToTask(taskId: string, attachment: { msgId: number; name: string; size: number }): Promise<string | null> {
  const { error } = await supabase
    .from('tasks')
    .update({ attachment_msg_id: attachment.msgId, attachment_name: attachment.name, attachment_size: attachment.size })
    .eq('id', taskId);
  return error ? error.message : null;
}

export async function setTeamTelegramChannel(teamId: string, channelId: string): Promise<string | null> {
  const { error } = await supabase.from('teams').update({ telegram_channel_id: channelId }).eq('id', teamId);
  return error ? error.message : null;
}
