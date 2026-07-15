import { supabase } from './supabaseClient';

export interface TeamMessage {
  id: string;
  team_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender?: { name: string; avatar: string } | null;
}

export interface DirectMessage {
  id: string;
  team_id: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  read: boolean;
  created_at: string;
}

export interface Conversation {
  otherUserId: string;
  otherName: string;
  otherAvatar: string;
  lastMessage: string;
  lastAt: string;
  unread: number;
}

export async function sendTeamMessage(teamId: string, body: string): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const senderId = userData.user?.id;
  if (!senderId) return 'Not signed in.';
  const { error } = await supabase.from('team_messages').insert({ team_id: teamId, sender_id: senderId, body });
  return error ? error.message : null;
}

export async function listTeamMessages(teamId: string, limit = 100): Promise<TeamMessage[]> {
  const { data } = await supabase
    .from('team_messages')
    .select('*, sender:profiles!team_messages_sender_id_fkey(name, avatar)')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data as unknown as TeamMessage[]) ?? []).reverse();
}

export function subscribeToTeamMessages(teamId: string, onMessage: (msg: TeamMessage) => void): () => void {
  const channel = supabase
    .channel(`team_messages:${teamId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages', filter: `team_id=eq.${teamId}` },
      payload => onMessage(payload.new as TeamMessage))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export async function sendDirectMessage(teamId: string, toUserId: string, body: string): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const senderId = userData.user?.id;
  if (!senderId) return 'Not signed in.';
  const { error } = await supabase.from('direct_messages').insert({ team_id: teamId, sender_id: senderId, receiver_id: toUserId, body });
  return error ? error.message : null;
}

export async function listDirectMessages(teamId: string, otherUserId: string): Promise<DirectMessage[]> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;
  if (!myId) return [];
  const { data } = await supabase
    .from('direct_messages')
    .select('*')
    .eq('team_id', teamId)
    .or(`and(sender_id.eq.${myId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${myId})`)
    .order('created_at', { ascending: true });
  return (data as DirectMessage[]) ?? [];
}

export function subscribeToDirectMessages(teamId: string, onMessage: (msg: DirectMessage) => void): () => void {
  const channel = supabase
    .channel(`direct_messages:${teamId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `team_id=eq.${teamId}` },
      payload => onMessage(payload.new as DirectMessage))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export async function markDirectMessagesRead(teamId: string, otherUserId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;
  if (!myId) return;
  await supabase.from('direct_messages').update({ read: true })
    .eq('team_id', teamId).eq('sender_id', otherUserId).eq('receiver_id', myId).eq('read', false);
}

export async function listConversations(teamId: string): Promise<Conversation[]> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;
  if (!myId) return [];

  const { data } = await supabase
    .from('direct_messages')
    .select('*, sender:profiles!direct_messages_sender_id_fkey(name, avatar), receiver:profiles!direct_messages_receiver_id_fkey(name, avatar)')
    .eq('team_id', teamId)
    .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`)
    .order('created_at', { ascending: false });

  const rows = (data as any[]) ?? [];
  const byPartner = new Map<string, Conversation>();
  for (const row of rows) {
    const isMine = row.sender_id === myId;
    const otherId = isMine ? row.receiver_id : row.sender_id;
    const otherProfile = isMine ? row.receiver : row.sender;
    if (!byPartner.has(otherId)) {
      byPartner.set(otherId, {
        otherUserId: otherId,
        otherName: otherProfile?.name || 'Unknown',
        otherAvatar: otherProfile?.avatar || '',
        lastMessage: row.body,
        lastAt: row.created_at,
        unread: 0,
      });
    }
    if (!isMine && !row.read) {
      byPartner.get(otherId)!.unread += 1;
    }
  }
  return Array.from(byPartner.values());
}
