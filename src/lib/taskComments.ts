import { supabase } from './supabaseClient';

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author?: { name: string; avatar: string } | null;
}

export async function listTaskComments(taskId: string): Promise<TaskComment[]> {
  const { data } = await supabase
    .from('task_comments')
    .select('*, author:profiles!task_comments_author_id_fkey(name, avatar)')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  return (data as unknown as TaskComment[]) ?? [];
}

export async function postTaskComment(taskId: string, body: string): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const authorId = userData.user?.id;
  if (!authorId) return 'Not signed in.';
  const { error } = await supabase.from('task_comments').insert({ task_id: taskId, author_id: authorId, body });
  return error ? error.message : null;
}

/** Only kept open while a task's detail/comment view is expanded, to avoid dozens of idle channels. */
export function subscribeToTaskComments(taskId: string, onComment: (comment: TaskComment) => void): () => void {
  const channel = supabase
    .channel(`task_comments:${taskId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` },
      payload => onComment(payload.new as TaskComment))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
