import { supabase } from './supabaseClient';
import { notify } from './notifications';

export interface Team {
  id: string;
  name: string;
  logo: string;
  owner_id: string;
  telegram_channel_id: string;
  description: string;
  visibility: 'public' | 'private';
  pay_note: string;
  join_ad_url: string | null;
  tags: string[];
  created_at: string;
}

export type JobTitle = 'Cleaning' | 'Translation' | 'Typesetting' | 'Proofreading' | 'Coloring' | 'Design';
export const JOB_TITLES: JobTitle[] = ['Cleaning', 'Translation', 'Typesetting', 'Proofreading', 'Coloring', 'Design'];

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string | null;
  invited_email: string;
  role: 'member' | 'leader';
  status: 'pending' | 'active';
  created_at: string;
  job_title: JobTitle | null;
  priority: number | null;
  balance: number;
  is_active: boolean;
  member_status: 'active' | 'on_leave' | 'resigned';
  streak_count: number;
  last_check_in: string | null;
  can_review_tasks: boolean;
  can_manage_bank: boolean;
  can_manage_join_requests: boolean;
  can_manage_vacations: boolean;
  notification_prefs: { broadcasts?: boolean; tasks?: boolean; chat?: boolean };
  profile?: { name: string; avatar: string; email: string } | null;
}

export type NotificationCategory = 'broadcasts' | 'tasks' | 'chat';

export async function updateMyNotificationPrefs(teamId: string, prefs: { broadcasts: boolean; tasks: boolean; chat: boolean }): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return 'Not signed in.';
  const { error } = await supabase.from('team_members').update({ notification_prefs: prefs }).eq('team_id', teamId).eq('user_id', userId);
  return error ? error.message : null;
}

export async function updateMemberFields(memberRowId: string, fields: Partial<Pick<TeamMember,
  'job_title' | 'priority' | 'balance' | 'can_review_tasks' | 'can_manage_bank' | 'can_manage_join_requests' | 'can_manage_vacations'
>>): Promise<string | null> {
  const { error } = await supabase.from('team_members').update(fields).eq('id', memberRowId);
  return error ? error.message : null;
}

export async function createTeam(input: { name: string; logo: string; description: string; visibility: 'public' | 'private'; payNote: string }): Promise<{ team: Team | null; error: string | null }> {
  const { data: userData } = await supabase.auth.getUser();
  const ownerId = userData.user?.id;
  if (!ownerId) return { team: null, error: 'Not signed in.' };

  const { data, error } = await supabase
    .from('teams')
    .insert({ name: input.name, logo: input.logo, owner_id: ownerId, description: input.description, visibility: input.visibility, pay_note: input.payNote })
    .select()
    .single();
  return { team: error ? null : (data as Team), error: error ? error.message : null };
}

export async function updateTeamSettings(teamId: string, fields: Partial<Pick<Team, 'name' | 'logo' | 'description' | 'visibility' | 'pay_note' | 'join_ad_url' | 'tags'>>): Promise<string | null> {
  const { error } = await supabase.from('teams').update(fields).eq('id', teamId);
  return error ? error.message : null;
}

export async function deleteTeam(teamId: string): Promise<string | null> {
  const { error } = await supabase.from('teams').delete().eq('id', teamId);
  return error ? error.message : null;
}

export async function broadcastToTeam(teamId: string, title: string, body: string): Promise<string | null> {
  const [{ data: activeMembers }, { data: team }] = await Promise.all([
    supabase.from('team_members').select('user_id, notification_prefs').eq('team_id', teamId).eq('status', 'active').not('user_id', 'is', null),
    supabase.from('teams').select('owner_id').eq('id', teamId).single(),
  ]);
  const recipients = new Set(
    (activeMembers ?? [])
      .filter(m => (m.notification_prefs as TeamMember['notification_prefs'] | null)?.broadcasts !== false)
      .map(m => m.user_id as string)
  );
  if (team?.owner_id) recipients.delete(team.owner_id);
  await Promise.all(Array.from(recipients).map(userId => notify(userId, title, body)));

  const { data: userData } = await supabase.auth.getUser();
  const senderId = userData.user?.id;
  if (senderId) {
    await supabase.from('team_messages').insert({ team_id: teamId, sender_id: senderId, body: `📢 ${title}\n${body}` });
  }
  return null;
}

export async function getMyOwnedTeam(): Promise<Team | null> {
  const { data: userData } = await supabase.auth.getUser();
  const ownerId = userData.user?.id;
  if (!ownerId) return null;
  const { data } = await supabase.from('teams').select().eq('owner_id', ownerId).maybeSingle();
  return (data as Team) ?? null;
}

export async function getMyMembership(): Promise<(TeamMember & { team: Team }) | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;
  const { data } = await supabase
    .from('team_members')
    .select('*, team:teams(*)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  return (data as (TeamMember & { team: Team })) ?? null;
}

export async function getPendingInvitesForMe(): Promise<(TeamMember & { team: Team })[]> {
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email;
  if (!email) return [];
  const { data } = await supabase
    .from('team_members')
    .select('*, team:teams(*)')
    .eq('invited_email', email)
    .eq('status', 'pending');
  return (data as (TeamMember & { team: Team })[]) ?? [];
}

export async function inviteMember(teamId: string, email: string): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const { error } = await supabase
    .from('team_members')
    .insert({ team_id: teamId, invited_email: normalizedEmail, status: 'pending' });
  if (error) return error.message;

  const [{ data: team }, { data: invitedProfile }] = await Promise.all([
    supabase.from('teams').select('name').eq('id', teamId).single(),
    supabase.from('profiles').select('id').eq('email', normalizedEmail).maybeSingle(),
  ]);
  if (invitedProfile?.id) {
    await notify(invitedProfile.id, 'Team invite', `You've been invited to join ${team?.name || 'a team'}.`);
  }
  return null;
}

export async function acceptInvite(memberRowId: string): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return 'Not signed in.';
  const { error } = await supabase
    .from('team_members')
    .update({ user_id: userId, status: 'active' })
    .eq('id', memberRowId);
  return error ? error.message : null;
}

export async function declineInvite(memberRowId: string): Promise<string | null> {
  const { error } = await supabase.from('team_members').delete().eq('id', memberRowId);
  return error ? error.message : null;
}

export async function removeMember(memberRowId: string): Promise<string | null> {
  const { error } = await supabase.from('team_members').delete().eq('id', memberRowId);
  return error ? error.message : null;
}

async function setRole(memberRowId: string, role: 'leader' | 'member', notifyTitle: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('team_members')
    .update({ role })
    .eq('id', memberRowId)
    .select('user_id, team_id, team:teams(name)')
    .single();
  if (error) return error.message;
  if (data?.user_id) {
    const teamName = (data as any).team?.name || 'your team';
    await notify(data.user_id, notifyTitle, `Your role in ${teamName} is now ${role}.`);
  }
  return null;
}

export async function promoteToLeader(memberRowId: string): Promise<string | null> {
  return setRole(memberRowId, 'leader', 'Promoted to Leader');
}

export async function demoteToMember(memberRowId: string): Promise<string | null> {
  return setRole(memberRowId, 'member', 'Role updated');
}

export async function getLeaderboard(teamId: string): Promise<TeamMember[]> {
  const { data } = await supabase
    .from('team_members')
    .select('*, profile:profiles(name, avatar, email)')
    .eq('team_id', teamId)
    .eq('status', 'active')
    .order('balance', { ascending: false })
    .limit(5);
  return (data as unknown as TeamMember[]) ?? [];
}

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const { data } = await supabase
    .from('team_members')
    .select('*, profile:profiles(name, avatar, email)')
    .eq('team_id', teamId)
    .order('created_at', { ascending: true });
  return (data as unknown as TeamMember[]) ?? [];
}
