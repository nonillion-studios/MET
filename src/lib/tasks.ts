import { supabase } from './supabaseClient';
import { notify } from './notifications';

export interface Task {
  id: string;
  team_id: string;
  creator_id: string;
  assignee_id: string;
  title: string;
  description: string;
  status: 'todo' | 'done';
  due_date: string | null;
  attachment_name: string;
  attachment_size: number;
  attachment_msg_id: number | null;
  created_at: string;
  completed_at: string | null;
  assignee?: { name: string; avatar: string; email: string } | null;
}

export async function createTask(input: { teamId: string; assigneeId: string; title: string; description: string; dueDate: string | null }): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const creatorId = userData.user?.id;
  if (!creatorId) return 'Not signed in.';
  const { error } = await supabase.from('tasks').insert({
    team_id: input.teamId,
    creator_id: creatorId,
    assignee_id: input.assigneeId,
    title: input.title,
    description: input.description,
    due_date: input.dueDate,
  });
  if (error) return error.message;
  await notify(input.assigneeId, 'New task assigned', input.title);
  return null;
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

export async function markTaskDone(taskId: string): Promise<string | null> {
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', taskId);
  return error ? error.message : null;
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
