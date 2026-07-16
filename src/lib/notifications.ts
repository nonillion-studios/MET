import { supabase } from './supabaseClient';

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
}

export async function listNotifications(): Promise<AppNotification[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];
  const { data } = await supabase
    .from('notifications')
    .select()
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (data as AppNotification[]) ?? [];
}

export async function unreadCount(): Promise<number> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return 0;
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);
  return count ?? 0;
}

export async function markRead(id: string): Promise<string | null> {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
  return error ? error.message : null;
}

export async function markAllRead(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return 'Not signed in.';
  const { error } = await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
  return error ? error.message : null;
}

export async function notify(userId: string, title: string, body = ''): Promise<string | null> {
  const { error } = await supabase.from('notifications').insert({ user_id: userId, title, body });
  return error ? error.message : null;
}

// Live-updates the topbar badge as rows land, and (if the user has granted
// permission) fires a browser Notification — this is the "web" half of the
// accept/reject notify requirement. There's no native mobile shell in this
// codebase, so an "app" push notification isn't implemented here.
export function subscribeToNotifications(userId: string, onNotification: (n: AppNotification) => void): () => void {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      payload => {
        const n = payload.new as AppNotification;
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(n.title, { body: n.body });
        }
        onNotification(n);
      })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export function requestNotificationPermission(): Promise<NotificationPermission> | null {
  if (typeof Notification === 'undefined') return null;
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
  return Notification.requestPermission();
}
