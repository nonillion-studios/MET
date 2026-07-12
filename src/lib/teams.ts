import { supabase } from './supabaseClient';
import { notify } from './notifications';

export interface Team {
  id: string;
  name: string;
  logo: string;
  owner_id: string;
  telegram_channel_id: string;
  created_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string | null;
  invited_email: string;
  role: 'member' | 'leader';
  status: 'pending' | 'active';
  created_at: string;
  profile?: { name: string; avatar: string; email: string } | null;
}

export async function createTeam(name: string, logo: string): Promise<{ team: Team | null; error: string | null }> {
  const { data: userData } = await supabase.auth.getUser();
  const ownerId = userData.user?.id;
  if (!ownerId) return { team: null, error: 'Not signed in.' };

  const { data, error } = await supabase
    .from('teams')
    .insert({ name, logo, owner_id: ownerId })
    .select()
    .single();
  return { team: error ? null : (data as Team), error: error ? error.message : null };
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

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const { data } = await supabase
    .from('team_members')
    .select('*, profile:profiles(name, avatar, email)')
    .eq('team_id', teamId)
    .order('created_at', { ascending: true });
  return (data as unknown as TeamMember[]) ?? [];
}
