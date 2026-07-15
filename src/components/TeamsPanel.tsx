import { useEffect, useRef, useState } from 'react';
import {
  Users, ImagePlus, Plus, Mail, Check, X, Crown, ShieldCheck, ArrowUpCircle, ArrowDownCircle, UserMinus,
  Send, ListTodo, Paperclip, CalendarClock, Trash2, Wallet, Flame, Trophy, BarChart3, Link as LinkIcon,
  ThumbsUp, ThumbsDown, Pencil, LogOut, Clock3, PiggyBank,
} from 'lucide-react';
import { GlassCard, Button, Input, Textarea, IconButton, Modal, Switch } from './ui';
import { swal, swalToast } from '../lib/swalTheme';
import { readAvatarFile } from '../lib/image';
import { useTeamAuth } from '../lib/teamAuth';
import {
  Team, TeamMember, JOB_TITLES, JobTitle,
  createTeam, getMyOwnedTeam, getMyMembership, getPendingInvitesForMe,
  inviteMember, acceptInvite, declineInvite, listTeamMembers, updateMemberFields,
  promoteToLeader, demoteToMember, removeMember, getLeaderboard,
} from '../lib/teams';
import {
  Task, TaskDifficulty, createTaskWithWorkflow, listTeamTasks, listMyTasks, deleteTask, attachFileToTask,
  setTeamTelegramChannel, acceptTask, declineTask, submitTask, approveTask, rejectSubmission,
  checkIn, setMemberActive, changePriority,
} from '../lib/tasks';
import { deposit, penalize, transfer, requestWithdrawal, decideWithdrawal, listPendingWithdrawals, listTransactions, Transaction, Withdrawal } from '../lib/wallet';
import {
  requestLeave, decideLeave, requestResignation, decideResignation,
  listPendingLeaveRequests, listPendingResignations, LeaveRequest, ResignationRequest,
} from '../lib/memberRequests';
import type { CloudClient } from '../lib/cloudClient';

type TabId = 'overview' | 'roster' | 'tasks' | 'bank' | 'requests' | 'leaderboard' | 'stats';

export function TeamsPanel({ cc }: { cc: CloudClient }) {
  const { session, isAdmin } = useTeamAuth();

  return (
    <div className="space-y-5">
      <div className="border-b border-hairline pb-4">
        <h2 className="text-lg font-display font-semibold text-ink flex items-center gap-2">
          <Users className="text-accent" size={20} /> Teams
        </h2>
        <p className="text-xs text-ink-muted mt-0.5">Signed in as {session?.user.email}</p>
      </div>

      {isAdmin ? <AdminTeamSection cc={cc} /> : <MemberTeamSection cc={cc} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab shell
// ---------------------------------------------------------------------------

const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: 'overview', label: 'Overview', icon: Users },
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'bank', label: 'Bank', icon: Wallet },
  { id: 'requests', label: 'Requests', icon: CalendarClock },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { id: 'stats', label: 'Stats', icon: BarChart3 },
];

function TeamWorkspace({
  team, members, isOwner, myMember, canManage, onChanged, cc,
}: {
  team: Team;
  members: TeamMember[];
  isOwner: boolean;
  myMember: TeamMember | null;
  canManage: boolean;
  onChanged: () => void;
  cc: CloudClient;
}) {
  const [tab, setTab] = useState<TabId>('overview');
  const visibleTabs = TABS.filter(t => t.id !== 'stats' || canManage);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {visibleTabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                tab === t.id ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'
              }`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && <OverviewTab team={team} myMember={myMember} canManage={canManage} members={members} onChanged={onChanged} />}
      {tab === 'roster' && <TeamRoster team={team} members={members} isOwner={isOwner} canManageMembers={canManage} onChanged={onChanged} />}
      {tab === 'tasks' && <TasksSection team={team} members={members} canManageTasks={canManage} myMember={myMember} cc={cc} />}
      {tab === 'bank' && <BankTab team={team} members={members} myMember={myMember} canManage={canManage} />}
      {tab === 'requests' && <RequestsTab team={team} myMember={myMember} canManage={canManage} onChanged={onChanged} />}
      {tab === 'leaderboard' && <LeaderboardTab team={team} />}
      {tab === 'stats' && canManage && <StatsTab team={team} members={members} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewTab({ team, myMember, canManage, members, onChanged }: { team: Team; myMember: TeamMember | null; canManage: boolean; members: TeamMember[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  const handleCheckIn = async () => {
    setBusy(true);
    const error = await checkIn(team.id);
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Check-in failed', text: error }); return; }
    swalToast({ icon: 'success', title: 'Checked in' });
    onChanged();
  };

  const handleToggleActive = async (value: boolean) => {
    const error = await setMemberActive(team.id, value);
    if (error) { swal({ icon: 'error', title: 'Could not update status', text: error }); return; }
    onChanged();
  };

  return (
    <div className="space-y-4">
      {myMember && (
        <GlassCard className="p-6 space-y-4 max-w-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-ink-faint">Your balance</p>
              <p className="text-2xl font-display font-bold text-ink">${myMember.balance.toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-ink-faint">Role</p>
              <p className="text-sm font-semibold text-accent flex items-center gap-1 justify-end">
                {myMember.role === 'leader' && <Crown size={12} />} {myMember.job_title || 'Unassigned'}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl border border-hairline">
            <div className="flex items-center gap-2">
              <Flame size={16} className="text-accent" />
              <span className="text-sm font-semibold text-ink">{myMember.streak_count} day streak</span>
            </div>
            <Button size="sm" onClick={handleCheckIn} disabled={busy}>Check in</Button>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl border border-hairline">
            <span className="text-sm font-semibold text-ink">Available for new tasks</span>
            <Switch checked={myMember.is_active} onChange={handleToggleActive} />
          </div>

          <p className="text-xs text-ink-faint">
            Status: <span className="font-semibold text-ink">{myMember.member_status.replace('_', ' ')}</span>
            {myMember.priority != null && <> · Priority <span className="font-semibold text-ink">{myMember.priority}</span></>}
          </p>
        </GlassCard>
      )}

      {canManage && (
        <GlassCard className="p-6 max-w-md">
          <h3 className="text-sm font-semibold text-ink mb-3">Team at a glance</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-ink-faint text-xs">Members</p><p className="font-bold text-ink">{members.filter(m => m.status === 'active').length}</p></div>
            <div><p className="text-ink-faint text-xs">Active/Available</p><p className="font-bold text-ink">{members.filter(m => m.status === 'active' && m.is_active).length}</p></div>
            <div><p className="text-ink-faint text-xs">On leave</p><p className="font-bold text-ink">{members.filter(m => m.member_status === 'on_leave').length}</p></div>
            <div><p className="text-ink-faint text-xs">Pending invites</p><p className="font-bold text-ink">{members.filter(m => m.status === 'pending').length}</p></div>
          </div>
        </GlassCard>
      )}

      {!myMember && !canManage && (
        <GlassCard className="p-8 max-w-md text-center">
          <p className="text-sm text-ink-muted">No personal dashboard for this account yet.</p>
        </GlassCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

function EditMemberModal({ member, onClose, onSaved }: { member: TeamMember; onClose: () => void; onSaved: () => void }) {
  const [jobTitle, setJobTitle] = useState<JobTitle | ''>(member.job_title || '');
  const [priority, setPriority] = useState(String(member.priority ?? ''));
  const [balance, setBalance] = useState(String(member.balance ?? 0));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const error = await updateMemberFields(member.id, {
      job_title: (jobTitle || null) as JobTitle | null,
      priority: priority ? Number(priority) : null,
      balance: Number(balance) || 0,
    });
    setSaving(false);
    if (error) { swal({ icon: 'error', title: 'Could not save', text: error }); return; }
    swalToast({ icon: 'success', title: 'Member updated' });
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Edit Member" size="sm" footer={
      <Button className="w-full" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</Button>
    }>
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Job Title</label>
          <select value={jobTitle} onChange={e => setJobTitle(e.target.value as JobTitle)} className="w-full bg-ink/5 border border-hairline rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-accent">
            <option value="">Unassigned</option>
            {JOB_TITLES.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Priority</label>
          <Input type="number" min={1} value={priority} onChange={e => setPriority(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Balance ($)</label>
          <Input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)} />
        </div>
      </div>
    </Modal>
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
  const [channelId, setChannelId] = useState(team.telegram_channel_id || '');
  const [savingChannel, setSavingChannel] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);

  const handleSaveChannel = async () => {
    setSavingChannel(true);
    const error = await setTeamTelegramChannel(team.id, channelId.trim());
    setSavingChannel(false);
    if (error) { swal({ icon: 'error', title: 'Could not save channel', text: error }); return; }
    swalToast({ icon: 'success', title: 'Telegram channel saved' });
    onChanged();
  };

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
    <GlassCard className="overflow-hidden max-w-md">
      {editing && <EditMemberModal member={editing} onClose={() => setEditing(null)} onSaved={onChanged} />}

      <div className="p-6 flex items-center gap-4 border-b border-hairline bg-ink/[0.02]">
        <div className="w-16 h-16 rounded-2xl overflow-hidden bg-accent-soft border border-hairline shrink-0 flex items-center justify-center">
          {team.logo ? <img src={team.logo} alt={team.name} className="w-full h-full object-cover" /> : <Users size={22} className="text-accent" />}
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-ink font-display truncate">{team.name}</h3>
          <p className="text-xs font-semibold text-accent flex items-center gap-1 mt-0.5">
            {isOwner ? <ShieldCheck size={12} /> : <Crown size={12} />}
            {isOwner ? 'Admin' : 'Leader'}
          </p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {canManageMembers && (
          <>
            <div className="flex gap-2">
              <Input placeholder="member@email.com" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="flex-1" />
              <Button onClick={handleInvite} disabled={inviting}>
                <Mail size={14} /> Invite
              </Button>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-accent font-semibold flex items-center gap-1"><Send size={12} /> Telegram Channel (for task attachments)</label>
              <div className="flex gap-2">
                <Input placeholder="@teamchannel or -100..." value={channelId} onChange={(e) => setChannelId(e.target.value)} className="flex-1" />
                <Button variant="secondary" onClick={handleSaveChannel} disabled={savingChannel}>Save</Button>
              </div>
            </div>
          </>
        )}

        <div className="space-y-2">
          {members.length === 0 && <p className="text-xs text-ink-faint text-center py-3">No members yet.</p>}
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-hairline hover:border-accent/20 transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-full overflow-hidden bg-ink/5 border border-hairline shrink-0 flex items-center justify-center">
                  {m.profile?.avatar ? <img src={m.profile.avatar} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-ink-faint font-semibold">{(m.profile?.name || m.invited_email)[0]?.toUpperCase()}</span>}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink truncate flex items-center gap-1">
                    {m.profile?.name || m.invited_email}
                    {m.role === 'leader' && <Crown size={11} className="text-accent shrink-0" />}
                  </p>
                  <p className="text-[10px] text-ink-faint truncate">
                    {m.job_title || 'No job title'}{m.priority != null ? ` · P${m.priority}` : ''}
                    {m.member_status !== 'active' && ` · ${m.member_status.replace('_', ' ')}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.status === 'active' ? 'bg-accent-soft text-accent' : 'bg-ink/5 text-ink-faint'}`}>
                  {m.status === 'active' ? 'Active' : 'Pending'}
                </span>
                {isOwner && m.status === 'active' && (
                  <button onClick={() => setEditing(m)} aria-label="Edit member" title="Edit member" className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors">
                    <Pencil size={13} />
                  </button>
                )}
                {isOwner && m.status === 'active' && (
                  m.role === 'leader' ? (
                    <button onClick={() => handleDemote(m.id)} disabled={busyId === m.id} aria-label="Demote to member" title="Demote to member" className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors">
                      <ArrowDownCircle size={14} />
                    </button>
                  ) : (
                    <button onClick={() => handlePromote(m.id)} disabled={busyId === m.id} aria-label="Promote to leader" title="Promote to leader" className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors">
                      <ArrowUpCircle size={14} />
                    </button>
                  )
                )}
                {canManageMembers && (
                  <button onClick={() => handleRemove(m.id)} disabled={busyId === m.id} aria-label="Remove member" title="Remove member" className="p-1.5 rounded-lg text-ink-faint hover:text-danger hover:bg-danger/10 transition-colors">
                    <UserMinus size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Admin / Member section resolution (unchanged shape, now mounts TeamWorkspace)
// ---------------------------------------------------------------------------

function AdminTeamSection({ cc }: { cc: CloudClient }) {
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
      <GlassCard className="overflow-hidden max-w-md">
        <div className="p-6 border-b border-hairline bg-ink/[0.02] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-soft border border-accent/20 flex items-center justify-center shrink-0">
            <ShieldCheck size={18} className="text-accent" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-ink font-display">Create Your Team</h3>
            <p className="text-xs text-ink-muted mt-0.5">Set a name and logo to get started</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
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
        </div>
      </GlassCard>
    );
  }

  return <TeamWorkspace team={team} members={members} isOwner myMember={null} canManage onChanged={refresh} cc={cc} />;
}

function MemberTeamSection({ cc }: { cc: CloudClient }) {
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
    const freshMe = members.find(m => m.id === membership.id) || membership;
    return (
      <TeamWorkspace
        team={membership.team}
        members={members}
        isOwner={false}
        myMember={freshMe}
        canManage={membership.role === 'leader'}
        onChanged={refresh}
        cc={cc}
      />
    );
  }

  if (invites.length > 0) {
    return (
      <div className="space-y-3 max-w-md">
        {invites.map(inv => (
          <GlassCard key={inv.id} className="overflow-hidden border-accent/30">
            <div className="p-5 flex items-center gap-3 bg-accent-soft">
              <div className="w-11 h-11 rounded-xl overflow-hidden bg-elevated border border-accent/30 shrink-0 flex items-center justify-center">
                {inv.team?.logo ? <img src={inv.team.logo} alt={inv.team?.name || 'Team'} className="w-full h-full object-cover" /> : <Mail size={18} className="text-accent" />}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-accent uppercase tracking-wide">Team Invitation</p>
                <p className="text-sm font-semibold text-ink truncate">{inv.team?.name || 'Unknown team'}</p>
              </div>
            </div>
            <div className="p-4 flex gap-2">
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
    <GlassCard className="p-8 max-w-md text-center">
      <div className="w-12 h-12 mx-auto rounded-full bg-ink/5 border border-hairline flex items-center justify-center mb-3">
        <Users size={20} className="text-ink-faint" />
      </div>
      <p className="text-sm font-semibold text-ink">No team yet</p>
      <p className="text-xs text-ink-muted mt-1">Ask your leader to sign you up.</p>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function formatDue(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const STATUS_LABEL: Record<Task['status'], string> = {
  todo: 'Offered',
  in_progress: 'In Progress',
  under_review: 'Under Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

function TaskAttachmentControl({ task, team, cc, onChanged }: { task: Task; team: Team; cc: CloudClient; onChanged: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleAttach = async (file: File) => {
    if (!team.telegram_channel_id) {
      swal({ icon: 'error', title: 'No Channel Set', text: 'Ask your leader to set the team Telegram channel first.' });
      return;
    }
    setBusy(true);
    const result = await cc.uploadTaskAttachment(team.telegram_channel_id, file);
    if (result) {
      await attachFileToTask(task.id, result);
      await submitTask(task.id, 'file', result.name);
    }
    setBusy(false);
    if (result) { swalToast({ icon: 'success', title: 'File submitted' }); onChanged(); }
  };

  const handleDownload = async () => {
    if (!team.telegram_channel_id || task.attachment_msg_id === null) return;
    setBusy(true);
    await cc.downloadTaskAttachment(team.telegram_channel_id, task.attachment_msg_id, task.attachment_name || 'attachment');
    setBusy(false);
  };

  if (task.attachment_msg_id) {
    return (
      <button onClick={handleDownload} disabled={busy} className="text-[11px] text-accent hover:text-ink flex items-center gap-1 font-semibold">
        <Paperclip size={11} /> {task.attachment_name || 'Attachment'}
      </button>
    );
  }

  return (
    <>
      <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAttach(f); }} />
      <button
        onClick={() => cc.isConnected ? fileInputRef.current?.click() : swal({ icon: 'info', title: 'Connect Telegram', text: 'Connect your Telegram account in Cloud Storage to attach files.' })}
        disabled={busy}
        className="text-[11px] text-ink-faint hover:text-accent flex items-center gap-1 font-semibold"
        title={cc.isConnected ? 'Submit a file' : 'Connect Telegram in Cloud Storage first'}
      >
        <Paperclip size={11} /> {busy ? 'Uploading...' : 'Submit file'}
      </button>
    </>
  );
}

function SubmitLinkControl({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!link.trim().startsWith('http')) {
      swal({ icon: 'error', title: 'Invalid link', text: 'Link must start with http:// or https://' });
      return;
    }
    setBusy(true);
    const error = await submitTask(task.id, 'link', link.trim());
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not submit', text: error }); return; }
    swalToast({ icon: 'success', title: 'Link submitted' });
    onChanged();
  };

  return (
    <div className="flex gap-1.5 mt-1">
      <Input placeholder="https://..." value={link} onChange={e => setLink(e.target.value)} className="!py-1.5 !text-[11px] flex-1" />
      <Button size="sm" onClick={handleSubmit} disabled={busy}><LinkIcon size={11} /></Button>
    </div>
  );
}

function RateSubmissionControl({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const [rating, setRating] = useState(5);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [notes, setNotes] = useState('');

  const handleApprove = async () => {
    setBusy(true);
    const error = await approveTask(task.id, rating);
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not approve', text: error }); return; }
    swalToast({ icon: 'success', title: `Approved · reward paid` });
    onChanged();
  };

  const handleReject = async () => {
    if (!notes.trim()) { swal({ icon: 'error', title: 'Notes required', text: 'Explain what needs to change.' }); return; }
    setBusy(true);
    const error = await rejectSubmission(task.id, notes.trim());
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not reject', text: error }); return; }
    swalToast({ icon: 'success', title: 'Sent back for revision' });
    onChanged();
  };

  if (rejecting) {
    return (
      <div className="flex gap-1.5 mt-1">
        <Input placeholder="Revision notes..." value={notes} onChange={e => setNotes(e.target.value)} className="!py-1.5 !text-[11px] flex-1" />
        <Button size="sm" variant="danger" onClick={handleReject} disabled={busy}>Send</Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <select value={rating} onChange={e => setRating(Number(e.target.value))} className="bg-ink/5 border border-hairline rounded-lg px-1.5 py-1 text-[11px] outline-none">
        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}
      </select>
      <Button size="sm" onClick={handleApprove} disabled={busy}><ThumbsUp size={11} /></Button>
      <Button size="sm" variant="secondary" onClick={() => setRejecting(true)} disabled={busy}><ThumbsDown size={11} /></Button>
    </div>
  );
}

function TasksSection({ team, members, canManageTasks, myMember, cc }: { team: Team; members: TeamMember[]; canManageTasks: boolean; myMember: TeamMember | null; cc: CloudClient }) {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState<TaskDifficulty>('Medium');
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setTasks(canManageTasks ? await listTeamTasks(team.id) : await listMyTasks(team.id));
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [team.id, canManageTasks]);

  const toggleJobType = (job: string) => {
    setJobTypes(prev => prev.includes(job) ? prev.filter(j => j !== job) : [...prev, job]);
  };

  const handleCreate = async () => {
    if (!title.trim() || jobTypes.length === 0) {
      swal({ icon: 'error', title: 'Missing details', text: 'Give the task a title and pick at least one job type.' });
      return;
    }
    setCreating(true);
    const error = await createTaskWithWorkflow({
      teamId: team.id, title: title.trim(), description: description.trim(),
      difficulty, jobTypes, dueDate: dueDate || null,
    });
    setCreating(false);
    if (error) { swal({ icon: 'error', title: 'Could not create task', text: error }); return; }
    setTitle(''); setDescription(''); setJobTypes([]); setDueDate(''); setDifficulty('Medium');
    swalToast({ icon: 'success', title: 'Task created and auto-assigned' });
    refresh();
  };

  const withBusy = (id: string, fn: () => Promise<string | null>, successTitle: string) => async () => {
    setBusyId(id);
    const error = await fn();
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Action failed', text: error }); return; }
    swalToast({ icon: 'success', title: successTitle });
    refresh();
  };

  const handleDelete = async (id: string) => {
    const result = await swal({ icon: 'warning', title: 'Delete this task?', showCancelButton: true, confirmButtonText: 'Delete', confirmButtonColor: '#FF3B30' });
    if (!result.isConfirmed) return;
    setBusyId(id);
    const error = await deleteTask(id);
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not delete task', text: error }); return; }
    refresh();
  };

  if (loading) return null;

  return (
    <GlassCard className="overflow-hidden max-w-md">
      <div className="p-6 border-b border-hairline bg-ink/[0.02] flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent-soft border border-accent/20 flex items-center justify-center shrink-0">
          <ListTodo size={18} className="text-accent" />
        </div>
        <div>
          <h3 className="text-base font-display font-display font-semibold text-ink">{canManageTasks ? 'Tasks' : 'My Tasks'}</h3>
          <p className="text-xs text-ink-muted mt-0.5">{canManageTasks ? 'Create and route work across the team' : 'Offered, in progress, and awaiting review'}</p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {canManageTasks && (
          <div className="space-y-2 pb-4 border-b border-hairline">
            <Input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            <div className="flex flex-wrap gap-1.5">
              {JOB_TITLES.map(job => (
                <button
                  key={job}
                  type="button"
                  onClick={() => toggleJobType(job)}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors ${jobTypes.includes(job) ? 'bg-accent text-white border-accent' : 'border-hairline text-ink-muted hover:border-accent/40'}`}
                >
                  {job}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as TaskDifficulty)} className="w-full bg-ink/5 border border-hairline rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-accent">
                <option value="Easy">Easy · $5</option>
                <option value="Medium">Medium · $10</option>
                <option value="Hard">Hard · $20</option>
              </select>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <Button onClick={handleCreate} disabled={creating} className="w-full">
              <Plus size={14} /> {creating ? 'Creating...' : 'Create Task'}
            </Button>
          </div>
        )}

        <div className="space-y-2">
          {tasks.length === 0 && <p className="text-xs text-ink-faint text-center py-3">{canManageTasks ? 'No tasks yet.' : 'No tasks assigned to you.'}</p>}
          {tasks.map(t => {
            const isMine = myMember && t.assignee_id === myMember.user_id;
            return (
              <div key={t.id} className={`p-3 rounded-xl border transition-colors ${t.status === 'done' || t.status === 'cancelled' ? 'border-hairline bg-ink/[0.02]' : 'border-hairline hover:border-accent/20'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold truncate ${t.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'}`}>{t.title}</p>
                    {t.description && <p className="text-xs text-ink-muted mt-0.5 whitespace-pre-line">{t.description}</p>}
                    <p className="text-[10px] text-ink-faint mt-1 flex flex-wrap items-center gap-x-2">
                      {canManageTasks && <span>{t.assignee?.name || 'Unassigned'}</span>}
                      <span>{t.difficulty} · ${t.reward ?? 0}</span>
                      {t.job_types?.length > 0 && <span>{t.job_types.join(', ')}</span>}
                    </p>
                  </div>
                  {canManageTasks && (
                    <button onClick={() => handleDelete(t.id)} disabled={busyId === t.id} aria-label="Delete task" className="p-1.5 rounded-lg text-ink-faint hover:text-danger hover:bg-danger/10 transition-colors shrink-0">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-hairline">
                  <div className="flex items-center gap-3">
                    {t.due_date && (
                      <span className="text-[10px] text-ink-faint flex items-center gap-1"><CalendarClock size={11} /> {formatDue(t.due_date)}</span>
                    )}
                    <span className="text-[10px] font-semibold text-ink-faint">{STATUS_LABEL[t.status]}</span>
                    {t.status === 'in_progress' && <TaskAttachmentControl task={t} team={team} cc={cc} onChanged={refresh} />}
                  </div>
                  {t.status === 'done' && (
                    <span className="text-[10px] font-semibold text-success flex items-center gap-1"><Check size={11} /> {t.rating ? `${t.rating}★` : 'Done'}</span>
                  )}
                </div>

                {!canManageTasks && isMine && t.status === 'todo' && (
                  <div className="flex gap-1.5 mt-2">
                    <Button size="sm" onClick={withBusy(t.id, () => acceptTask(t.id), 'Task accepted')} disabled={busyId === t.id} className="flex-1">Accept</Button>
                    <Button size="sm" variant="secondary" onClick={withBusy(t.id, () => declineTask(t.id), 'Task passed on')} disabled={busyId === t.id} className="flex-1">Decline</Button>
                  </div>
                )}
                {!canManageTasks && isMine && t.status === 'in_progress' && (
                  <SubmitLinkControl task={t} onChanged={refresh} />
                )}
                {canManageTasks && t.status === 'under_review' && (
                  <RateSubmissionControl task={t} onChanged={refresh} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------

function BankTab({ team, members, myMember, canManage }: { team: Team; members: TeamMember[]; myMember: TeamMember | null; canManage: boolean }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [targetId, setTargetId] = useState('');
  const [amount, setAmount] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const [tx, wd] = await Promise.all([
      listTransactions(team.id, myMember?.user_id || undefined),
      canManage ? listPendingWithdrawals(team.id) : Promise.resolve([]),
    ]);
    setTransactions(tx);
    setWithdrawals(wd);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [team.id, canManage]);

  const otherMembers = members.filter(m => m.status === 'active' && m.user_id && m.user_id !== myMember?.user_id);

  const run = async (fn: () => Promise<string | null>, successTitle: string) => {
    if (!amount || Number(amount) <= 0) { swal({ icon: 'error', title: 'Enter a valid amount' }); return; }
    setBusy(true);
    const error = await fn();
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Action failed', text: error }); return; }
    swalToast({ icon: 'success', title: successTitle });
    setAmount(''); setDetails('');
    refresh();
  };

  const handleWithdrawalDecision = async (id: string, approve: boolean) => {
    const error = await decideWithdrawal(id, approve);
    if (error) { swal({ icon: 'error', title: 'Action failed', text: error }); return; }
    refresh();
  };

  if (loading) return null;

  return (
    <div className="space-y-4 max-w-md">
      {(myMember || canManage) && (
        <GlassCard className="p-6 space-y-3">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><PiggyBank size={16} className="text-accent" /> {canManage ? 'Team Treasury' : 'Send / Withdraw'}</h3>

          {otherMembers.length > 0 && (
            <select value={targetId} onChange={e => setTargetId(e.target.value)} className="w-full bg-ink/5 border border-hairline rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-accent">
              <option value="">Select member...</option>
              {otherMembers.map(m => <option key={m.id} value={m.user_id!}>{m.profile?.name || m.invited_email}</option>)}
            </select>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" step="0.01" placeholder="Amount ($)" value={amount} onChange={e => setAmount(e.target.value)} />
            <Input placeholder="Note" value={details} onChange={e => setDetails(e.target.value)} />
          </div>

          <div className="flex flex-wrap gap-2">
            {canManage && (
              <>
                <Button size="sm" disabled={busy || !targetId} onClick={() => run(() => deposit(team.id, targetId, Number(amount), details), 'Deposit sent')}>Deposit</Button>
                <Button size="sm" variant="danger" disabled={busy || !targetId} onClick={() => run(() => penalize(team.id, targetId, Number(amount), details), 'Penalty applied')}>Penalize</Button>
              </>
            )}
            {myMember && (
              <>
                <Button size="sm" variant="secondary" disabled={busy || !targetId} onClick={() => run(() => transfer(team.id, targetId, Number(amount), details), 'Transfer sent')}>Transfer</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => requestWithdrawal(team.id, Number(amount)), 'Withdrawal requested')}>Request withdrawal</Button>
              </>
            )}
          </div>
        </GlassCard>
      )}

      {canManage && withdrawals.length > 0 && (
        <GlassCard className="p-6 space-y-2">
          <h3 className="text-sm font-semibold text-ink">Pending Withdrawals</h3>
          {withdrawals.map(w => (
            <div key={w.id} className="flex items-center justify-between p-2.5 rounded-xl border border-hairline text-xs">
              <span className="font-semibold text-ink">{w.user?.name || w.user?.email} · ${w.amount.toFixed(2)}</span>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => handleWithdrawalDecision(w.id, true)}>Approve</Button>
                <Button size="sm" variant="secondary" onClick={() => handleWithdrawalDecision(w.id, false)}>Reject</Button>
              </div>
            </div>
          ))}
        </GlassCard>
      )}

      <GlassCard className="p-6 space-y-2">
        <h3 className="text-sm font-semibold text-ink">Recent Transactions</h3>
        {transactions.length === 0 && <p className="text-xs text-ink-faint text-center py-3">No transactions yet.</p>}
        {transactions.map(tx => (
          <div key={tx.id} className="flex items-center justify-between p-2 text-xs border-b border-hairline last:border-0">
            <div className="min-w-0">
              <p className="text-ink font-medium truncate">{tx.details || (tx.sender_id ? 'Transfer' : 'System')}</p>
              <p className="text-ink-faint text-[10px]">{tx.sender?.name || 'System'} → {tx.receiver?.name}</p>
            </div>
            <span className={`font-semibold shrink-0 ${tx.amount < 0 ? 'text-danger' : 'text-success'}`}>{tx.amount < 0 ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}</span>
          </div>
        ))}
      </GlassCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Requests (leave / resignation)
// ---------------------------------------------------------------------------

function RequestsTab({ team, myMember, canManage, onChanged }: { team: Team; myMember: TeamMember | null; canManage: boolean; onChanged: () => void }) {
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [resignations, setResignations] = useState<ResignationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveDuration, setLeaveDuration] = useState('');
  const [resignReason, setResignReason] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!canManage) { setLoading(false); return; }
    setLoading(true);
    const [l, r] = await Promise.all([listPendingLeaveRequests(team.id), listPendingResignations(team.id)]);
    setLeaves(l); setResignations(r);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [team.id, canManage]);

  const handleRequestLeave = async () => {
    if (!leaveReason.trim() || !leaveDuration.trim()) { swal({ icon: 'error', title: 'Fill in both fields' }); return; }
    setBusy(true);
    const error = await requestLeave(team.id, leaveReason.trim(), leaveDuration.trim());
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not submit', text: error }); return; }
    swalToast({ icon: 'success', title: 'Leave requested' });
    setLeaveReason(''); setLeaveDuration('');
  };

  const handleRequestResignation = async () => {
    if (!resignReason.trim()) { swal({ icon: 'error', title: 'Reason required' }); return; }
    const result = await swal({ icon: 'warning', title: 'Submit resignation?', showCancelButton: true, confirmButtonText: 'Submit', confirmButtonColor: '#FF3B30' });
    if (!result.isConfirmed) return;
    setBusy(true);
    const error = await requestResignation(team.id, resignReason.trim());
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not submit', text: error }); return; }
    swalToast({ icon: 'success', title: 'Resignation submitted' });
    setResignReason('');
  };

  return (
    <div className="space-y-4 max-w-md">
      {myMember && (
        <GlassCard className="p-6 space-y-4">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><Clock3 size={15} className="text-accent" /> Request Leave</h3>
            <Input placeholder="Reason" value={leaveReason} onChange={e => setLeaveReason(e.target.value)} />
            <Input placeholder="Duration (e.g. Aug 1 – Aug 7)" value={leaveDuration} onChange={e => setLeaveDuration(e.target.value)} />
            <Button size="sm" onClick={handleRequestLeave} disabled={busy}>Submit</Button>
          </div>
          <div className="space-y-2 pt-3 border-t border-hairline">
            <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><LogOut size={15} className="text-danger" /> Resign</h3>
            <Input placeholder="Reason" value={resignReason} onChange={e => setResignReason(e.target.value)} />
            <Button size="sm" variant="danger" onClick={handleRequestResignation} disabled={busy}>Submit Resignation</Button>
          </div>
        </GlassCard>
      )}

      {canManage && !loading && (
        <>
          <GlassCard className="p-6 space-y-2">
            <h3 className="text-sm font-semibold text-ink">Pending Leave Requests</h3>
            {leaves.length === 0 && <p className="text-xs text-ink-faint text-center py-3">None pending.</p>}
            {leaves.map(l => (
              <div key={l.id} className="p-2.5 rounded-xl border border-hairline text-xs space-y-1.5">
                <p className="font-semibold text-ink">{l.user?.name || l.user?.email}</p>
                <p className="text-ink-muted">{l.duration} — {l.reason}</p>
                <div className="flex gap-1">
                  <Button size="sm" onClick={async () => { await decideLeave(l.id, true); refresh(); onChanged(); }}>Approve</Button>
                  <Button size="sm" variant="secondary" onClick={async () => { await decideLeave(l.id, false); refresh(); }}>Reject</Button>
                </div>
              </div>
            ))}
          </GlassCard>

          <GlassCard className="p-6 space-y-2">
            <h3 className="text-sm font-semibold text-ink">Pending Resignations</h3>
            {resignations.length === 0 && <p className="text-xs text-ink-faint text-center py-3">None pending.</p>}
            {resignations.map(r => (
              <div key={r.id} className="p-2.5 rounded-xl border border-hairline text-xs space-y-1.5">
                <p className="font-semibold text-ink">{r.user?.name || r.user?.email}</p>
                <p className="text-ink-muted">{r.reason}</p>
                <div className="flex gap-1">
                  <Button size="sm" variant="danger" onClick={async () => { await decideResignation(r.id, true); refresh(); onChanged(); }}>Accept</Button>
                  <Button size="sm" variant="secondary" onClick={async () => { await decideResignation(r.id, false); refresh(); }}>Reject</Button>
                </div>
              </div>
            ))}
          </GlassCard>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard & Stats
// ---------------------------------------------------------------------------

function LeaderboardTab({ team }: { team: Team }) {
  const [top, setTop] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => { setTop(await getLeaderboard(team.id)); setLoading(false); })();
  }, [team.id]);

  if (loading) return null;

  return (
    <GlassCard className="p-6 max-w-md space-y-2">
      <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><Trophy size={16} className="text-accent" /> Top Earners</h3>
      {top.length === 0 && <p className="text-xs text-ink-faint text-center py-3">No data yet.</p>}
      {top.map((m, i) => (
        <div key={m.id} className="flex items-center justify-between p-2.5 rounded-xl border border-hairline">
          <span className="text-sm font-semibold text-ink">#{i + 1} {m.profile?.name || m.invited_email}</span>
          <span className="text-sm font-bold text-accent">${m.balance.toFixed(2)}</span>
        </div>
      ))}
    </GlassCard>
  );
}

function StatsTab({ team, members }: { team: Team; members: TeamMember[] }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => { setTasks(await listTeamTasks(team.id)); setLoading(false); })();
  }, [team.id]);

  if (loading) return null;

  const done = tasks.filter(t => t.status === 'done').length;
  const overdue = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done' && t.status !== 'cancelled');

  return (
    <div className="space-y-4 max-w-md">
      <GlassCard className="p-6 space-y-2">
        <h3 className="text-sm font-semibold text-ink">Team Report</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-ink-faint text-xs">Members</p><p className="font-bold text-ink">{members.length}</p></div>
          <div><p className="text-ink-faint text-xs">Tasks total</p><p className="font-bold text-ink">{tasks.length}</p></div>
          <div><p className="text-ink-faint text-xs">Completed</p><p className="font-bold text-ink">{done}</p></div>
          <div><p className="text-ink-faint text-xs">Overdue</p><p className="font-bold text-danger">{overdue.length}</p></div>
        </div>
      </GlassCard>

      {overdue.length > 0 && (
        <GlassCard className="p-6 space-y-2">
          <h3 className="text-sm font-semibold text-ink">Overdue Tasks</h3>
          {overdue.map(t => (
            <div key={t.id} className="p-2.5 rounded-xl border border-danger/30 text-xs">
              <p className="font-semibold text-ink">{t.title}</p>
              <p className="text-ink-faint">Due {formatDue(t.due_date)} · {STATUS_LABEL[t.status]}</p>
            </div>
          ))}
        </GlassCard>
      )}

      <GlassCard className="p-6 space-y-2">
        <h3 className="text-sm font-semibold text-ink">Members</h3>
        {members.map(m => (
          <div key={m.id} className="flex items-center justify-between p-2 text-xs border-b border-hairline last:border-0">
            <span className="text-ink">{m.profile?.name || m.invited_email} <span className="text-ink-faint">({m.job_title || 'no job'})</span></span>
            <span className="font-semibold text-ink">${m.balance.toFixed(2)}</span>
          </div>
        ))}
      </GlassCard>
    </div>
  );
}
