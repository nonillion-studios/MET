import { useEffect, useRef, useState } from 'react';
import { Users, ImagePlus, Plus, Mail, Check, X, Crown, ShieldCheck, ArrowUpCircle, ArrowDownCircle, UserMinus } from 'lucide-react';
import { GlassCard, Button, Input } from './ui';
import { swal, swalToast } from '../lib/swalTheme';
import { readAvatarFile } from '../lib/image';
import { useTeamAuth } from '../lib/teamAuth';
import {
  Team, TeamMember,
  createTeam, getMyOwnedTeam, getMyMembership, getPendingInvitesForMe,
  inviteMember, acceptInvite, declineInvite, listTeamMembers,
  promoteToLeader, demoteToMember, removeMember,
} from '../lib/teams';

export function TeamsPanel() {
  const { session, isAdmin } = useTeamAuth();

  return (
    <div className="space-y-5">
      <div className="border-b border-hairline pb-4">
        <h2 className="text-lg font-display font-semibold text-ink flex items-center gap-2">
          <Users className="text-accent" size={20} /> Teams
        </h2>
        <p className="text-xs text-ink-muted mt-0.5">Signed in as {session?.user.email}</p>
      </div>

      {isAdmin ? <AdminTeamSection /> : <MemberTeamSection />}
    </div>
  );
}

function TeamRoster({
  team, members, isOwner, canManageMembers, onChanged,
}: {
  team: Team;
  members: TeamMember[];
  isOwner: boolean;
  canManageMembers: boolean;
  onChanged: () => void;
}) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      swal({ icon: 'error', title: 'Email Required', text: 'Enter an email to invite.' });
      return;
    }
    setInviting(true);
    const error = await inviteMember(team.id, inviteEmail.trim());
    setInviting(false);
    if (error) {
      swal({ icon: 'error', title: 'Invite failed', text: error });
      return;
    }
    setInviteEmail('');
    swalToast({ icon: 'success', title: 'Invite sent' });
    onChanged();
  };

  const handlePromote = async (id: string) => {
    setBusyId(id);
    const error = await promoteToLeader(id);
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not promote', text: error }); return; }
    swalToast({ icon: 'success', title: 'Promoted to leader' });
    onChanged();
  };

  const handleDemote = async (id: string) => {
    setBusyId(id);
    const error = await demoteToMember(id);
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not demote', text: error }); return; }
    swalToast({ icon: 'success', title: 'Demoted to member' });
    onChanged();
  };

  const handleRemove = async (id: string) => {
    const result = await swal({
      icon: 'warning',
      title: 'Remove this member?',
      showCancelButton: true,
      confirmButtonText: 'Remove',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    setBusyId(id);
    const error = await removeMember(id);
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not remove member', text: error }); return; }
    onChanged();
  };

  return (
    <GlassCard className="p-6 space-y-4 max-w-md">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl overflow-hidden bg-ink/5 border border-hairline shrink-0 flex items-center justify-center">
          {team.logo ? <img src={team.logo} alt={team.name} className="w-full h-full object-cover" /> : <Users size={18} className="text-ink-faint" />}
        </div>
        <div>
          <h3 className="text-base font-semibold text-ink font-display">{team.name}</h3>
          <p className="text-xs text-ink-muted">{isOwner ? 'You are the admin' : 'You are a leader'}</p>
        </div>
      </div>

      {canManageMembers && (
        <div className="flex gap-2">
          <Input placeholder="member@email.com" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="flex-1" />
          <Button onClick={handleInvite} disabled={inviting}>
            <Mail size={14} /> Invite
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {members.length === 0 && <p className="text-xs text-ink-faint">No members yet.</p>}
        {members.map(m => (
          <div key={m.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-hairline">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-full overflow-hidden bg-ink/5 border border-hairline shrink-0 flex items-center justify-center">
                {m.profile?.avatar ? <img src={m.profile.avatar} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-ink-faint">?</span>}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink truncate flex items-center gap-1">
                  {m.profile?.name || m.invited_email}
                  {m.role === 'leader' && <Crown size={11} className="text-accent shrink-0" />}
                </p>
                <p className="text-[10px] text-ink-faint truncate">{m.invited_email}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.status === 'active' ? 'bg-accent-soft text-accent' : 'bg-ink/5 text-ink-faint'}`}>
                {m.status === 'active' ? 'Active' : 'Pending'}
              </span>
              {isOwner && m.status === 'active' && (
                m.role === 'leader' ? (
                  <button onClick={() => handleDemote(m.id)} disabled={busyId === m.id} aria-label="Demote to member" className="text-ink-faint hover:text-accent transition-colors">
                    <ArrowDownCircle size={15} />
                  </button>
                ) : (
                  <button onClick={() => handlePromote(m.id)} disabled={busyId === m.id} aria-label="Promote to leader" className="text-ink-faint hover:text-accent transition-colors">
                    <ArrowUpCircle size={15} />
                  </button>
                )
              )}
              {canManageMembers && (
                <button onClick={() => handleRemove(m.id)} disabled={busyId === m.id} aria-label="Remove member" className="text-ink-faint hover:text-danger transition-colors">
                  <UserMinus size={15} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function AdminTeamSection() {
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teamName, setTeamName] = useState('');
  const [logo, setLogo] = useState('');
  const [creating, setCreating] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setLoading(true);
    const owned = await getMyOwnedTeam();
    setTeam(owned);
    if (owned) setMembers(await listTeamMembers(owned.id));
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleCreate = async () => {
    if (!teamName.trim()) {
      swal({ icon: 'error', title: 'Name Required', text: 'Give your team a name.' });
      return;
    }
    setCreating(true);
    const { team: created, error } = await createTeam(teamName.trim(), logo);
    setCreating(false);
    if (error) {
      swal({ icon: 'error', title: 'Could not create team', text: error });
      return;
    }
    setTeam(created);
    swalToast({ icon: 'success', title: 'Team created' });
  };

  if (loading) return null;

  if (!team) {
    return (
      <GlassCard className="p-6 space-y-4 max-w-md">
        <h3 className="text-base font-semibold text-ink font-display flex items-center gap-2">
          <ShieldCheck size={16} className="text-accent" /> Create Your Team
        </h3>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => logoInputRef.current?.click()}
            className="w-16 h-16 rounded-2xl border border-dashed border-hairline bg-ink/5 flex items-center justify-center overflow-hidden shrink-0 hover:border-accent transition-colors"
          >
            {logo ? <img src={logo} alt="Logo" className="w-full h-full object-cover" /> : <ImagePlus size={18} className="text-ink-faint" />}
          </button>
          <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readAvatarFile(f, setLogo); }} />
          <div className="flex-1 space-y-1">
            <label className="text-xs text-accent font-semibold">Team Name</label>
            <Input placeholder="e.g. Nightfall Scans" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          </div>
        </div>
        <Button onClick={handleCreate} disabled={creating} className="w-full">
          <Plus size={14} /> {creating ? 'Creating...' : 'Create Team'}
        </Button>
      </GlassCard>
    );
  }

  return <TeamRoster team={team} members={members} isOwner canManageMembers onChanged={refresh} />;
}

function MemberTeamSection() {
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState<(TeamMember & { team: Team }) | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<(TeamMember & { team: Team })[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const active = await getMyMembership();
    setMembership(active);
    if (active) {
      setMembers(await listTeamMembers(active.team_id));
    } else {
      setInvites(await getPendingInvitesForMe());
    }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleAccept = async (id: string) => {
    setBusyId(id);
    const error = await acceptInvite(id);
    setBusyId(null);
    if (error) {
      swal({ icon: 'error', title: 'Could not accept invite', text: error });
      return;
    }
    swalToast({ icon: 'success', title: 'Joined team' });
    await refresh();
  };

  const handleDecline = async (id: string) => {
    setBusyId(id);
    const error = await declineInvite(id);
    setBusyId(null);
    if (error) {
      swal({ icon: 'error', title: 'Could not decline invite', text: error });
      return;
    }
    await refresh();
  };

  if (loading) return null;

  if (membership) {
    return (
      <TeamRoster
        team={membership.team}
        members={members}
        isOwner={false}
        canManageMembers={membership.role === 'leader'}
        onChanged={refresh}
      />
    );
  }

  if (invites.length > 0) {
    return (
      <div className="space-y-3 max-w-md">
        {invites.map(inv => (
          <GlassCard key={inv.id} className="p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden bg-ink/5 border border-hairline shrink-0 flex items-center justify-center">
                {inv.team.logo ? <img src={inv.team.logo} alt={inv.team.name} className="w-full h-full object-cover" /> : <Users size={16} className="text-ink-faint" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">{inv.team.name}</p>
                <p className="text-xs text-ink-muted">invited you to join</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => handleAccept(inv.id)} disabled={busyId === inv.id} className="flex-1">
                <Check size={14} /> Accept
              </Button>
              <Button variant="secondary" onClick={() => handleDecline(inv.id)} disabled={busyId === inv.id} className="flex-1">
                <X size={14} /> Decline
              </Button>
            </div>
          </GlassCard>
        ))}
      </div>
    );
  }

  return (
    <GlassCard className="p-6 max-w-md text-center">
      <Users size={22} className="text-ink-faint mx-auto mb-2" />
      <p className="text-sm text-ink-muted">Ask your leader to sign you up.</p>
    </GlassCard>
  );
}
