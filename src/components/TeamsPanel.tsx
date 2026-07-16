import { useEffect, useRef, useState } from 'react';
import {
  Users, ImagePlus, Plus, Mail, Check, X, Crown, ShieldCheck, ArrowUpCircle, ArrowDownCircle, UserMinus,
  Send, ListTodo, Paperclip, CalendarClock, Trash2, Wallet, Flame, Trophy, BarChart3, Link as LinkIcon,
  ThumbsUp, ThumbsDown, Pencil, LogOut, Clock3, PiggyBank, Home, MessageCircle, Globe, Lock, ArrowLeft, UserPlus, Hash,
  Megaphone, AlertTriangle,
} from 'lucide-react';
import { GlassCard, Button, Input, Textarea, Modal, Switch } from './ui';
import { swal, swalToast } from '../lib/swalTheme';
import { readAvatarFile, uploadImageToStorage } from '../lib/image';
import { useTeamAuth } from '../lib/teamAuth';
import {
  Team, TeamMember, JOB_TITLES, JobTitle,
  createTeam, getMyOwnedTeam, getMyMembership, getPendingInvitesForMe,
  inviteMember, acceptInvite, declineInvite, listTeamMembers, updateMemberFields,
  promoteToLeader, demoteToMember, removeMember, getLeaderboard,
  updateTeamSettings, deleteTeam, broadcastToTeam, updateMyNotificationPrefs,
} from '../lib/teams';
import {
  Task, createTaskWithWorkflow, listTeamTasks, listMyTasks, deleteTask, attachFileToTask,
  setTeamTelegramChannel, acceptTask, declineTask, submitTask, approveTask, rejectSubmission,
  checkIn, setMemberActive, expireStaleOffers, reassignMemberTasks, notifyUpcomingTaskDeadlines,
} from '../lib/tasks';
import { deposit, penalize, transfer, requestWithdrawal, decideWithdrawal, listPendingWithdrawals, listTransactions, Transaction, Withdrawal } from '../lib/wallet';
import {
  requestLeave, decideLeave, requestResignation, decideResignation,
  listPendingLeaveRequests, listPendingResignations, LeaveRequest, ResignationRequest,
} from '../lib/memberRequests';
import {
  requestToJoinTeam, decideJoinRequest, listPublicTeams, listPendingJoinRequests, expireStaleJoinRequests,
  createInviteToken, redeemInviteToken, getPublicTeamLeaderboard, PublicTeamLeaderboardRow,
  listResponseTemplates, upsertResponseTemplate, deleteResponseTemplate, ResponseTemplate,
  JoinRequest, PublicTeamCard,
} from '../lib/joinRequests';
import {
  sendTeamMessage, listTeamMessages, subscribeToTeamMessages, TeamMessage,
  sendDirectMessage, listDirectMessages, subscribeToDirectMessages, listConversations, markDirectMessagesRead, DirectMessage, Conversation,
} from '../lib/chat';
import { requestOwnerTransfer, decideOwnerTransfer, getMyPendingOwnerTransfers, OwnerTransferRequest } from '../lib/ownerTransfer';
import { listTeamBadges, TeamBadge } from '../lib/teamBadges';
import { getCurrentSeasonLeaderboard, closeCurrentSeason, SeasonLeaderboardRow } from '../lib/seasons';
import { exportTeamReportDocx } from '../lib/teamReport';
import type { CloudClient, CloudFile, CloudFolder } from '../lib/cloudClient';
import { CloudFolders } from './cloud/CloudFolders';
import { Folder as FolderIcon, Upload, Download } from 'lucide-react';

type SectionId = 'dashboard' | 'tasks' | 'bank' | 'chat' | 'files' | 'requests' | 'roster' | 'analytics' | 'admin';

export function TeamsPanel({ cc, pendingJoinToken, onConsumedJoinToken }: { cc: CloudClient; pendingJoinToken?: string | null; onConsumedJoinToken?: () => void }) {
  const { session, isAdmin } = useTeamAuth();

  return (
    <div className="space-y-5">
      <div className="border-b border-hairline pb-4">
        <h2 className="text-lg font-display font-semibold text-ink flex items-center gap-2">
          <Users className="text-accent" size={20} /> Teams
        </h2>
        <p className="text-xs text-ink-muted mt-0.5">Signed in as {session?.user.email}</p>
      </div>

      {pendingJoinToken && onConsumedJoinToken && (
        <RedeemInviteTokenModal token={pendingJoinToken} onClose={onConsumedJoinToken} />
      )}

      <PendingOwnerTransfers />

      {isAdmin ? <AdminTeamSection cc={cc} /> : <MemberTeamSection cc={cc} />}
    </div>
  );
}

function RedeemInviteTokenModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setSending(true);
    const error = await redeemInviteToken(token, message.trim());
    setSending(false);
    if (error) { swal({ icon: 'error', title: 'Could not join', text: error }); onClose(); return; }
    swalToast({ icon: 'success', title: 'Join request sent' });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Join via invite link" size="sm" footer={
      <Button className="w-full" onClick={handleSend} disabled={sending}>{sending ? 'Sending...' : 'Send Join Request'}</Button>
    }>
      <div className="space-y-1">
        <label className="text-xs text-accent font-semibold">Message (optional letter to the admin)</label>
        <Textarea placeholder="Tell them a bit about yourself..." value={message} onChange={e => setMessage(e.target.value)} rows={4} />
      </div>
    </Modal>
  );
}

function PendingOwnerTransfers() {
  const [offers, setOffers] = useState<OwnerTransferRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => { getMyPendingOwnerTransfers().then(setOffers); };
  useEffect(refresh, []);

  const handleDecide = async (id: string, accept: boolean) => {
    setBusyId(id);
    const error = await decideOwnerTransfer(id, accept);
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not respond', text: error }); return; }
    swalToast({ icon: 'success', title: accept ? 'Ownership accepted' : 'Offer declined' });
    refresh();
  };

  if (offers.length === 0) return null;

  return (
    <div className="space-y-2">
      {offers.map(o => (
        <GlassCard key={o.id} className="p-4 flex items-center justify-between gap-3 border-accent/30">
          <p className="text-sm text-ink">
            <span className="font-semibold">Ownership offer:</span> you've been nominated to own <span className="font-semibold">{o.team?.name || 'a team'}</span>.
          </p>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" onClick={() => handleDecide(o.id, true)} disabled={busyId === o.id}><Check size={13} /> Accept</Button>
            <Button size="sm" variant="secondary" onClick={() => handleDecide(o.id, false)} disabled={busyId === o.id}><X size={13} /> Decline</Button>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard shell
// ---------------------------------------------------------------------------

const SECTIONS: { id: SectionId; label: string; icon: typeof Users; forOwnerOnly?: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'bank', label: 'Bank', icon: Wallet },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'files', label: 'Files', icon: FolderIcon },
  { id: 'requests', label: 'Requests', icon: CalendarClock },
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'admin', label: 'Admin', icon: ShieldCheck, forOwnerOnly: true },
];

interface Perms {
  isOwner: boolean;
  canManage: boolean; // owner or leader (blanket — invites, telegram channel, task creation)
  canReviewTasks: boolean;
  canManageBank: boolean;
  canManageJoinRequests: boolean;
  canManageVacations: boolean;
}

function SectionHeader({ icon: Icon, title, description }: { icon: typeof Users; title: string; description?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-10 h-10 rounded-xl bg-accent-soft border border-accent/20 flex items-center justify-center text-accent shrink-0">
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <h2 className="text-base font-display font-semibold text-ink">{title}</h2>
        {description && <p className="text-xs text-ink-muted mt-0.5">{description}</p>}
      </div>
    </div>
  );
}

const SECTION_DESCRIPTIONS: Partial<Record<SectionId, string>> = {
  dashboard: 'Your status, balance, and streak at a glance',
  tasks: 'Offer, accept, submit, and review work',
  bank: 'Transfers, deposits, and withdrawals',
  chat: 'Team channel and direct messages',
  files: "Everything sitting in the team's shared Telegram channel",
  requests: 'Leave, resignation, and join requests',
  roster: 'Members, roles, and permissions',
  analytics: 'Leaderboard and team-wide report',
  admin: 'Team settings, broadcasts, and danger zone',
};

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
  const perms: Perms = {
    isOwner,
    canManage,
    canReviewTasks: isOwner || !!myMember?.can_review_tasks,
    canManageBank: isOwner || !!myMember?.can_manage_bank,
    canManageJoinRequests: isOwner || !!myMember?.can_manage_join_requests,
    canManageVacations: isOwner || !!myMember?.can_manage_vacations,
  };

  const visibleSections = SECTIONS.filter(s => !s.forOwnerOnly || isOwner);

  const jumpTo = (id: SectionId) => {
    document.getElementById(`team-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-10">
      <nav className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 backdrop-blur-xl bg-surface/80 border-b border-hairline flex items-center gap-1.5 overflow-x-auto">
        {visibleSections.map(s => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => jumpTo(s.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 bg-ink/5 text-ink-muted hover:bg-accent-soft hover:text-accent transition-colors"
            >
              <Icon size={13} /> {s.label}
            </button>
          );
        })}
      </nav>

      <section id="team-section-dashboard" className="scroll-mt-20">
        <SectionHeader icon={Home} title="Dashboard" description={SECTION_DESCRIPTIONS.dashboard} />
        <DashboardSection team={team} myMember={myMember} canManage={canManage} members={members} onChanged={onChanged} />
      </section>

      <section id="team-section-tasks" className="scroll-mt-20">
        <SectionHeader icon={ListTodo} title="Tasks" description={SECTION_DESCRIPTIONS.tasks} />
        <TasksSection team={team} members={members} canManageTasks={canManage} canReviewTasks={perms.canReviewTasks} myMember={myMember} cc={cc} />
      </section>

      <section id="team-section-bank" className="scroll-mt-20">
        <SectionHeader icon={Wallet} title="Bank" description={SECTION_DESCRIPTIONS.bank} />
        <BankTab team={team} members={members} myMember={myMember} canManageBank={perms.canManageBank} />
      </section>

      <section id="team-section-chat" className="scroll-mt-20">
        <SectionHeader icon={MessageCircle} title="Chat" description={SECTION_DESCRIPTIONS.chat} />
        <ChatSection team={team} members={members} myMember={myMember} />
      </section>

      <section id="team-section-files" className="scroll-mt-20">
        <SectionHeader icon={FolderIcon} title="Files" description={SECTION_DESCRIPTIONS.files} />
        <TeamFilesSection team={team} canManage={canManage} cc={cc} />
      </section>

      <section id="team-section-requests" className="scroll-mt-20">
        <SectionHeader icon={CalendarClock} title="Requests" description={SECTION_DESCRIPTIONS.requests} />
        <RequestsTab team={team} myMember={myMember} canManageVacations={perms.canManageVacations} canManageJoinRequests={perms.canManageJoinRequests} onChanged={onChanged} />
      </section>

      <section id="team-section-roster" className="scroll-mt-20">
        <SectionHeader icon={Users} title="Roster" description={SECTION_DESCRIPTIONS.roster} />
        <TeamRoster team={team} members={members} isOwner={isOwner} canManageMembers={canManage} onChanged={onChanged} />
      </section>

      <section id="team-section-analytics" className="scroll-mt-20">
        <SectionHeader icon={BarChart3} title="Analytics" description={SECTION_DESCRIPTIONS.analytics} />
        <AnalyticsSection team={team} members={members} />
      </section>

      {isOwner && (
        <section id="team-section-admin" className="scroll-mt-20">
          <SectionHeader icon={ShieldCheck} title="Admin" description={SECTION_DESCRIPTIONS.admin} />
          <AdminSection team={team} members={members} onChanged={onChanged} />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function DashboardSection({ team, myMember, canManage, members, onChanged }: { team: Team; myMember: TeamMember | null; canManage: boolean; members: TeamMember[]; onChanged: () => void }) {
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
    <div className="grid gap-4 md:grid-cols-2">
      {myMember && (
        <GlassCard className="p-6 space-y-4">
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

      {myMember && <MyNotificationPrefsCard team={team} myMember={myMember} onChanged={onChanged} />}

      {canManage && (
        <GlassCard className="p-6">
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
        <GlassCard className="p-8 text-center md:col-span-2">
          <p className="text-sm text-ink-muted">No personal dashboard for this account yet.</p>
        </GlassCard>
      )}
    </div>
  );
}

function MyNotificationPrefsCard({ team, myMember, onChanged }: { team: Team; myMember: TeamMember; onChanged: () => void }) {
  const prefs = { broadcasts: true, tasks: true, chat: true, ...myMember.notification_prefs };

  const handleToggle = async (key: 'broadcasts' | 'tasks' | 'chat', value: boolean) => {
    const next = { ...prefs, [key]: value };
    const error = await updateMyNotificationPrefs(team.id, next);
    if (error) { swal({ icon: 'error', title: 'Could not save', text: error }); return; }
    onChanged();
  };

  return (
    <GlassCard className="p-6 space-y-3">
      <h3 className="text-sm font-semibold text-ink">My Notifications</h3>
      {([
        ['broadcasts', 'Team broadcasts'],
        ['tasks', 'New task assignments'],
        ['chat', 'Chat messages'],
      ] as const).map(([key, label]) => (
        <div key={key} className="flex items-center justify-between">
          <span className="text-sm text-ink-muted">{label}</span>
          <Switch checked={prefs[key] !== false} onChange={v => handleToggle(key, v)} />
        </div>
      ))}
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

const PERM_TOGGLES: { key: 'can_review_tasks' | 'can_manage_bank' | 'can_manage_join_requests' | 'can_manage_vacations'; label: string }[] = [
  { key: 'can_review_tasks', label: 'Review tasks' },
  { key: 'can_manage_bank', label: 'Manage bank' },
  { key: 'can_manage_join_requests', label: 'Manage join requests' },
  { key: 'can_manage_vacations', label: 'Manage vacations' },
];

function EditMemberModal({ member, onClose, onSaved }: { member: TeamMember; onClose: () => void; onSaved: () => void }) {
  const [jobTitle, setJobTitle] = useState<JobTitle | ''>(member.job_title || '');
  const [priority, setPriority] = useState(String(member.priority ?? ''));
  const [balance, setBalance] = useState(String(member.balance ?? 0));
  const [perms, setPerms] = useState({
    can_review_tasks: member.can_review_tasks,
    can_manage_bank: member.can_manage_bank,
    can_manage_join_requests: member.can_manage_join_requests,
    can_manage_vacations: member.can_manage_vacations,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const error = await updateMemberFields(member.id, {
      job_title: (jobTitle || null) as JobTitle | null,
      priority: priority ? Number(priority) : null,
      balance: Number(balance) || 0,
      ...perms,
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

        {member.role === 'leader' && (
          <div className="space-y-1.5 pt-2 border-t border-hairline">
            <label className="text-xs text-accent font-semibold">Sub-admin permissions</label>
            {PERM_TOGGLES.map(p => (
              <div key={p.key} className="flex items-center justify-between py-1">
                <span className="text-xs text-ink">{p.label}</span>
                <Switch checked={perms[p.key]} onChange={v => setPerms(prev => ({ ...prev, [p.key]: v }))} />
              </div>
            ))}
          </div>
        )}
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
  const [reassignFrom, setReassignFrom] = useState<TeamMember | null>(null);
  const [badges, setBadges] = useState<TeamBadge[]>([]);
  useEffect(() => { listTeamBadges(team.id).then(setBadges); }, [team.id]);

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
    <GlassCard className="overflow-hidden max-w-2xl">
      {editing && <EditMemberModal member={editing} onClose={() => setEditing(null)} onSaved={onChanged} />}
      {reassignFrom && (
        <ReassignTasksModal
          team={team}
          fromMember={reassignFrom}
          members={members.filter(m => m.id !== reassignFrom.id && m.status === 'active' && m.user_id)}
          onClose={() => setReassignFrom(null)}
          onDone={onChanged}
        />
      )}

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
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {badges.map(b => (
                <span key={b.code} className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-accent-soft text-accent flex items-center gap-1"><Trophy size={9} /> {b.label}</span>
              ))}
            </div>
          )}
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
                {canManageMembers && (m.member_status === 'on_leave' || m.member_status === 'resigned') && m.user_id && (
                  <button onClick={() => setReassignFrom(m)} aria-label="Reassign open tasks" title="Reassign open tasks" className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors">
                    <ListTodo size={14} />
                  </button>
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

function ReassignTasksModal({ team, fromMember, members, onClose, onDone }: {
  team: Team; fromMember: TeamMember; members: TeamMember[]; onClose: () => void; onDone: () => void;
}) {
  const [toUserId, setToUserId] = useState('');
  const [busy, setBusy] = useState(false);

  const handleReassign = async () => {
    if (!toUserId || !fromMember.user_id) return;
    setBusy(true);
    const { moved, error } = await reassignMemberTasks(team.id, fromMember.user_id, toUserId);
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not reassign', text: error }); return; }
    swalToast({ icon: 'success', title: `${moved} task${moved === 1 ? '' : 's'} reassigned` });
    onDone();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Reassign ${fromMember.profile?.name || fromMember.invited_email}'s open tasks`} size="sm" footer={
      <Button className="w-full" onClick={handleReassign} disabled={busy || !toUserId}>{busy ? 'Reassigning...' : 'Reassign'}</Button>
    }>
      <div className="space-y-2">
        <label className="text-xs text-accent font-semibold">Move to</label>
        <select
          value={toUserId}
          onChange={e => setToUserId(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-hairline bg-transparent text-sm text-ink"
        >
          <option value="">Select a member...</option>
          {members.map(m => (
            <option key={m.id} value={m.user_id!}>{m.profile?.name || m.invited_email}</option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Admin / Member section resolution (unchanged shape, now mounts TeamWorkspace)
// ---------------------------------------------------------------------------

function AdminTeamSection({ cc }: { cc: CloudClient }) {
  const { session } = useTeamAuth();
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teamName, setTeamName] = useState('');
  const [logo, setLogo] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [payNote, setPayNote] = useState('');
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
    let logoUrl = logo;
    if (logo.startsWith('data:') && session?.user.id) {
      const uploaded = await uploadImageToStorage(logo, `${session.user.id}/team-logo-${Date.now()}.jpg`);
      if (uploaded) logoUrl = uploaded;
    }
    const { team: created, error } = await createTeam({ name: teamName.trim(), logo: logoUrl, description: description.trim(), visibility, payNote: payNote.trim() });
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
          <div className="space-y-1">
            <label className="text-xs text-accent font-semibold">Description</label>
            <Textarea placeholder="What does this team work on?" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-accent font-semibold">Usual Pay</label>
            <Input placeholder="e.g. $10–20 per task" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl border border-hairline">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              {visibility === 'public' ? <Globe size={14} className="text-accent" /> : <Lock size={14} className="text-ink-faint" />}
              {visibility === 'public' ? 'Public — listed in the directory' : 'Private — join by ID only'}
            </div>
            <Switch checked={visibility === 'public'} onChange={v => setVisibility(v ? 'public' : 'private')} />
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

  return (
    <div className="space-y-4">
      {invites.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
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
      )}

      <TeamDirectory />
    </div>
  );
}

type TeamCategory = 'all' | 'active' | 'members' | 'popular' | 'pay';

const CATEGORY_TABS: { id: TeamCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Most Active' },
  { id: 'members', label: 'Most Members' },
  { id: 'popular', label: 'Most Popular' },
  { id: 'pay', label: 'Most Pay' },
];

function parsePayNote(note: string): number {
  const match = note.match(/[\d,.]+/);
  if (!match) return -1;
  const n = parseFloat(match[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : -1;
}

function sortTeamsByCategory(teams: PublicTeamCard[], category: TeamCategory): PublicTeamCard[] {
  const copy = [...teams];
  switch (category) {
    case 'members':
      return copy.sort((a, b) => b.member_count - a.member_count);
    case 'active':
      // Backed by team_activity_log (chat/task/check-in events, last 7 days).
      return copy.sort((a, b) => b.activity_count - a.activity_count || b.member_count - a.member_count);
    case 'popular':
      // Approximation: popularity would ideally use join-request volume;
      // falls back to member count until a lightweight stats RPC exists.
      return copy.sort((a, b) => b.member_count - a.member_count);
    case 'pay':
      return copy.sort((a, b) => parsePayNote(b.pay_note || '') - parsePayNote(a.pay_note || ''));
    default:
      return copy;
  }
}

interface DirectoryPrefs { category: TeamCategory; search: string; tag: string }
const DIRECTORY_PREFS_KEY = 'teams_directory_prefs';

function loadDirectoryPrefs(): DirectoryPrefs {
  try {
    const raw = localStorage.getItem(DIRECTORY_PREFS_KEY);
    if (raw) return { category: 'all', search: '', tag: '', ...JSON.parse(raw) };
  } catch { /* ignore malformed prefs */ }
  return { category: 'all', search: '', tag: '' };
}

function PublicTeamLeaderboard() {
  const [rows, setRows] = useState<PublicTeamLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPublicTeamLeaderboard().then(r => { setRows(r); setLoading(false); });
  }, []);

  if (loading) return null;
  if (rows.length === 0) return <GlassCard className="p-8 text-center"><p className="text-sm text-ink-muted">No leaderboard data yet.</p></GlassCard>;

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <GlassCard key={r.team_id} className="p-4 flex items-center gap-3">
          <span className="text-sm font-bold text-ink-faint w-6 text-center shrink-0">#{i + 1}</span>
          <div className="w-9 h-9 rounded-xl overflow-hidden bg-accent-soft border border-hairline shrink-0 flex items-center justify-center">
            {r.team_logo ? <img src={r.team_logo} alt={r.team_name} className="w-full h-full object-cover" /> : <Users size={14} className="text-accent" />}
          </div>
          <span className="text-sm font-semibold text-ink flex-1 min-w-0 truncate">{r.team_name}</span>
          <span className="text-xs text-ink-faint shrink-0">{r.tasks_done} tasks done</span>
        </GlassCard>
      ))}
    </div>
  );
}

function CurrentSeasonLeaderboard() {
  const { isAdmin } = useTeamAuth();
  const [rows, setRows] = useState<SeasonLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);

  const refresh = () => { getCurrentSeasonLeaderboard().then(r => { setRows(r); setLoading(false); }); };
  useEffect(refresh, []);

  const handleCloseSeason = async () => {
    const result = await swal({
      icon: 'warning',
      title: 'Close the current season?',
      text: 'This locks in final standings, awards the champion badge, and starts a new season.',
      showCancelButton: true,
      confirmButtonText: 'Close Season',
    });
    if (!result.isConfirmed) return;
    setClosing(true);
    const error = await closeCurrentSeason();
    setClosing(false);
    if (error) { swal({ icon: 'error', title: 'Could not close season', text: error }); return; }
    swalToast({ icon: 'success', title: 'Season closed — a new one has started' });
    refresh();
  };

  if (loading) return null;

  return (
    <div className="space-y-2">
      {isAdmin && (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={handleCloseSeason} disabled={closing}>{closing ? 'Closing...' : 'Close Season'}</Button>
        </div>
      )}
      {rows.length === 0 ? (
        <GlassCard className="p-8 text-center"><p className="text-sm text-ink-muted">No season data yet.</p></GlassCard>
      ) : rows.map((r, i) => (
        <GlassCard key={r.team_id} className={`p-4 flex items-center gap-3 ${r.featured ? 'border-accent/40' : ''}`}>
          <span className="text-sm font-bold text-ink-faint w-6 text-center shrink-0">#{i + 1}</span>
          <div className="w-9 h-9 rounded-xl overflow-hidden bg-accent-soft border border-hairline shrink-0 flex items-center justify-center">
            {r.team_logo ? <img src={r.team_logo} alt={r.team_name} className="w-full h-full object-cover" /> : <Users size={14} className="text-accent" />}
          </div>
          <span className="text-sm font-semibold text-ink flex-1 min-w-0 truncate flex items-center gap-1.5">
            {r.team_name}
            {r.featured && <Trophy size={12} className="text-accent" />}
          </span>
          <span className="text-xs text-ink-faint shrink-0">{r.tasks_done} tasks · {r.activity_score} activity</span>
        </GlassCard>
      ))}
    </div>
  );
}

function TeamDirectory() {
  const [teams, setTeams] = useState<PublicTeamCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinTarget, setJoinTarget] = useState<PublicTeamCard | { id: string; name: string } | null>(null);
  const [teamIdInput, setTeamIdInput] = useState('');
  const [view, setView] = useState<'directory' | 'leaderboard' | 'season'>('directory');
  const initialPrefs = useRef(loadDirectoryPrefs()).current;
  const [category, setCategory] = useState<TeamCategory>(initialPrefs.category);
  const [search, setSearch] = useState(initialPrefs.search);
  const [tagFilter, setTagFilter] = useState(initialPrefs.tag);

  useEffect(() => {
    (async () => { setTeams(await listPublicTeams()); setLoading(false); })();
  }, []);

  useEffect(() => {
    localStorage.setItem(DIRECTORY_PREFS_KEY, JSON.stringify({ category, search, tag: tagFilter }));
  }, [category, search, tagFilter]);

  const handleJoinById = () => {
    if (!teamIdInput.trim()) return;
    setJoinTarget({ id: teamIdInput.trim(), name: 'this team' });
  };

  if (loading) return null;

  const allTags = Array.from(new Set(teams.flatMap(t => t.tags || []))).sort();
  let filteredTeams = teams;
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filteredTeams = filteredTeams.filter(t => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q));
  }
  if (tagFilter) {
    filteredTeams = filteredTeams.filter(t => (t.tags || []).includes(tagFilter));
  }
  const sortedTeams = sortTeamsByCategory(filteredTeams, category);

  return (
    <div className="space-y-4">
      {joinTarget && <RequestJoinModal target={joinTarget} onClose={() => setJoinTarget(null)} />}

      <GlassCard className="p-6 space-y-2 max-w-md mx-auto text-center">
        <h3 className="text-sm font-semibold text-ink flex items-center justify-center gap-2"><Hash size={15} className="text-accent" /> Join by Team ID</h3>
        <div className="flex gap-2">
          <Input placeholder="Paste a team ID" value={teamIdInput} onChange={e => setTeamIdInput(e.target.value)} className="flex-1" />
          <Button onClick={handleJoinById}>Request</Button>
        </div>
      </GlassCard>

      <div className="flex justify-center gap-1.5">
        <button type="button" onClick={() => setView('directory')} className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${view === 'directory' ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'}`}>Directory</button>
        <button type="button" onClick={() => setView('leaderboard')} className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1 ${view === 'leaderboard' ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'}`}><Trophy size={12} /> All-Time</button>
        <button type="button" onClick={() => setView('season')} className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1 ${view === 'season' ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'}`}><Flame size={12} /> Season</button>
      </div>

      {view === 'leaderboard' ? <PublicTeamLeaderboard /> : view === 'season' ? <CurrentSeasonLeaderboard /> : (
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="text-sm font-semibold text-ink">Public Teams</h3>
          <Input placeholder="Search teams..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-[220px]" />
        </div>
        {allTags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-2">
            <button
              type="button"
              onClick={() => setTagFilter('')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                !tagFilter ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'
              }`}
            >
              All Tags
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => setTagFilter(tag)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                  tagFilter === tag ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-end flex-wrap gap-2 mb-3">
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORY_TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategory(tab.id)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
                  category === tab.id ? 'bg-accent text-white shadow-sm' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {sortedTeams.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <p className="text-sm text-ink-muted">No public teams yet.</p>
          </GlassCard>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sortedTeams.map(t => (
              <GlassCard key={t.id} className="overflow-hidden flex flex-col">
                {t.join_ad_url && (
                  <div className="w-full aspect-[16/7] overflow-hidden border-b border-hairline bg-ink/[0.03]">
                    <img src={t.join_ad_url} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="p-5 flex flex-col items-center text-center gap-2 border-b border-hairline bg-ink/[0.02]">
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-accent-soft border border-hairline shrink-0 flex items-center justify-center">
                    {t.logo ? <img src={t.logo} alt={t.name} className="w-full h-full object-cover" /> : <Users size={20} className="text-accent" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{t.name}</p>
                    <p className="text-[10px] text-ink-faint">{t.member_count} member{t.member_count === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <div className="p-4 space-y-2 text-center flex-1 flex flex-col">
                  {t.description && <p className="text-xs text-ink-muted line-clamp-2">{t.description}</p>}
                  {t.pay_note && <p className="text-xs font-semibold text-accent">{t.pay_note}</p>}
                  {t.tags && t.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-center">
                      {t.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-ink/5 text-ink-muted">{tag}</span>
                      ))}
                    </div>
                  )}
                  {t.badges && t.badges.length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-center">
                      {t.badges.map(b => (
                        <span key={b.code} className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-accent-soft text-accent flex items-center gap-1"><Trophy size={9} /> {b.label}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex-1" />
                  <Button size="sm" className="w-full" onClick={() => setJoinTarget(t)}><UserPlus size={13} /> Request to Join</Button>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function RequestJoinModal({ target, onClose }: { target: { id: string; name: string }; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setSending(true);
    const error = await requestToJoinTeam(target.id, message.trim());
    setSending(false);
    if (error) { swal({ icon: 'error', title: 'Could not send request', text: error }); return; }
    swalToast({ icon: 'success', title: 'Join request sent' });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Request to join ${target.name}`} size="sm" footer={
      <Button className="w-full" onClick={handleSend} disabled={sending}>{sending ? 'Sending...' : 'Send Request'}</Button>
    }>
      <div className="space-y-1">
        <label className="text-xs text-accent font-semibold">Message (optional letter to the admin)</label>
        <Textarea placeholder="Tell them a bit about yourself..." value={message} onChange={e => setMessage(e.target.value)} rows={4} />
      </div>
    </Modal>
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

function TasksSection({ team, members, canManageTasks, canReviewTasks, myMember, cc }: { team: Team; members: TeamMember[]; canManageTasks: boolean; canReviewTasks: boolean; myMember: TeamMember | null; cc: CloudClient }) {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [reward, setReward] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    await expireStaleOffers(team.id);
    await notifyUpcomingTaskDeadlines(team.id);
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
      jobTypes, dueDate: dueDate || null, reward: reward ? Number(reward) : undefined,
    });
    setCreating(false);
    if (error) { swal({ icon: 'error', title: 'Could not create task', text: error }); return; }
    setTitle(''); setDescription(''); setJobTypes([]); setDueDate(''); setReward('');
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
    <GlassCard className="overflow-hidden max-w-2xl">
      <div className="p-6 border-b border-hairline bg-ink/[0.02] flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent-soft border border-accent/20 flex items-center justify-center shrink-0">
          <ListTodo size={18} className="text-accent" />
        </div>
        <div>
          <h3 className="text-base font-display font-semibold text-ink">{canManageTasks ? 'Tasks' : 'My Tasks'}</h3>
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
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              <Input type="number" step="0.01" placeholder="Reward ($, optional)" value={reward} onChange={(e) => setReward(e.target.value)} />
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
                      {t.reward != null && <span>${t.reward}</span>}
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
                {canReviewTasks && t.status === 'under_review' && (
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

function BankTab({ team, members, myMember, canManageBank: canManage }: { team: Team; members: TeamMember[]; myMember: TeamMember | null; canManageBank: boolean }) {
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
    <div className="grid gap-4 lg:grid-cols-2">
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

function JoinRequestRow({ request, teamId, onDecided }: { request: JoinRequest; teamId: string; onDecided: () => void }) {
  const [templates, setTemplates] = useState<ResponseTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { listResponseTemplates(teamId).then(setTemplates); }, [teamId]);

  const handleDecide = async (approve: boolean) => {
    setBusy(true);
    const body = templates.find(t => t.id === templateId)?.body;
    await decideJoinRequest(request.id, approve, body);
    setBusy(false);
    onDecided();
  };

  return (
    <div className="p-2.5 rounded-xl border border-hairline text-xs space-y-1.5">
      <p className="font-semibold text-ink">{request.user?.name || request.user?.email}</p>
      {request.message && <p className="text-ink-muted whitespace-pre-line">{request.message}</p>}
      {templates.length > 0 && (
        <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-hairline bg-transparent text-ink">
          <option value="">Default response...</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      )}
      <div className="flex gap-1">
        <Button size="sm" onClick={() => handleDecide(true)} disabled={busy}>Approve</Button>
        <Button size="sm" variant="secondary" onClick={() => handleDecide(false)} disabled={busy}>Reject</Button>
      </div>
    </div>
  );
}

function ResponseTemplatesCard({ team }: { team: Team }) {
  const [templates, setTemplates] = useState<ResponseTemplate[]>([]);
  const [label, setLabel] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = () => { listResponseTemplates(team.id).then(setTemplates); };
  useEffect(refresh, [team.id]);

  const handleSave = async () => {
    if (!label.trim() || !body.trim()) return;
    setSaving(true);
    const error = await upsertResponseTemplate(team.id, label.trim(), body.trim());
    setSaving(false);
    if (error) { swal({ icon: 'error', title: 'Could not save template', text: error }); return; }
    setLabel(''); setBody('');
    refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteResponseTemplate(id);
    refresh();
  };

  return (
    <GlassCard className="p-6 space-y-3">
      <h3 className="text-sm font-semibold text-ink">Response Templates</h3>
      {templates.map(t => (
        <div key={t.id} className="flex items-start justify-between gap-2 p-2.5 rounded-xl border border-hairline text-xs">
          <div className="min-w-0"><p className="font-semibold text-ink">{t.label}</p><p className="text-ink-muted line-clamp-2">{t.body}</p></div>
          <button onClick={() => handleDelete(t.id)} aria-label="Delete template" className="p-1 rounded-lg text-ink-faint hover:text-danger shrink-0"><Trash2 size={13} /></button>
        </div>
      ))}
      <div className="space-y-1.5 pt-2 border-t border-hairline">
        <Input placeholder="Label (e.g. Welcome)" value={label} onChange={e => setLabel(e.target.value)} />
        <Textarea placeholder="Response message" value={body} onChange={e => setBody(e.target.value)} rows={2} />
        <Button size="sm" onClick={handleSave} disabled={saving}>Add Template</Button>
      </div>
    </GlassCard>
  );
}

function RequestsTab({ team, myMember, canManageVacations, canManageJoinRequests, onChanged }: { team: Team; myMember: TeamMember | null; canManageVacations: boolean; canManageJoinRequests: boolean; onChanged: () => void }) {
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [resignations, setResignations] = useState<ResignationRequest[]>([]);
  const [joins, setJoins] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveDuration, setLeaveDuration] = useState('');
  const [resignReason, setResignReason] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    if (canManageJoinRequests) await expireStaleJoinRequests(team.id);
    const [l, r, j] = await Promise.all([
      canManageVacations ? listPendingLeaveRequests(team.id) : Promise.resolve([]),
      canManageVacations ? listPendingResignations(team.id) : Promise.resolve([]),
      canManageJoinRequests ? listPendingJoinRequests(team.id) : Promise.resolve([]),
    ]);
    setLeaves(l); setResignations(r); setJoins(j);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [team.id, canManageVacations, canManageJoinRequests]);

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
    <div className="grid gap-4 lg:grid-cols-2">
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

      {!loading && canManageJoinRequests && (
        <>
          <GlassCard className="p-6 space-y-2">
            <h3 className="text-sm font-semibold text-ink">Pending Join Requests</h3>
            {joins.length === 0 && <p className="text-xs text-ink-faint text-center py-3">None pending.</p>}
            {joins.map(j => (
              <JoinRequestRow key={j.id} request={j} teamId={team.id} onDecided={() => { refresh(); onChanged(); }} />
            ))}
          </GlassCard>
          <ResponseTemplatesCard team={team} />
        </>
      )}

      {!loading && canManageVacations && (
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
// Analytics (leaderboard + team report, open to every member)
// ---------------------------------------------------------------------------

function AnalyticsSection({ team, members }: { team: Team; members: TeamMember[] }) {
  const [top, setTop] = useState<TeamMember[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      const [t, tk] = await Promise.all([getLeaderboard(team.id), listTeamTasks(team.id)]);
      setTop(t); setTasks(tk); setLoading(false);
    })();
  }, [team.id]);

  const handleExportReport = async () => {
    setExporting(true);
    const transactions = await listTransactions(team.id);
    await exportTeamReportDocx({ team, members, tasks, transactions });
    setExporting(false);
  };

  if (loading) return null;

  const done = tasks.filter(t => t.status === 'done').length;
  const overdue = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done' && t.status !== 'cancelled');
  const completionRate = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
  const completedWithDates = tasks.filter(t => t.status === 'done' && t.completed_at);
  const avgTurnaroundDays = completedWithDates.length > 0
    ? (completedWithDates.reduce((sum, t) => sum + (new Date(t.completed_at!).getTime() - new Date(t.created_at).getTime()), 0) / completedWithDates.length) / 86400000
    : 0;
  const memberReliability = members
    .filter(m => m.status === 'active')
    .map(m => {
      const assigned = tasks.filter(t => t.assignee_id === m.user_id);
      const finished = assigned.filter(t => t.status === 'done');
      return { name: m.profile?.name || m.invited_email, rate: assigned.length > 0 ? Math.round((finished.length / assigned.length) * 100) : null, assigned: assigned.length };
    })
    .filter(m => m.assigned > 0)
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <GlassCard className="p-6 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Team Report</h3>
          <Button size="sm" variant="secondary" onClick={handleExportReport} disabled={exporting}>{exporting ? 'Exporting...' : 'Export Report'}</Button>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-ink-faint text-xs">Members</p><p className="font-bold text-ink">{members.length}</p></div>
          <div><p className="text-ink-faint text-xs">Tasks total</p><p className="font-bold text-ink">{tasks.length}</p></div>
          <div><p className="text-ink-faint text-xs">Completed</p><p className="font-bold text-ink">{done}</p></div>
          <div><p className="text-ink-faint text-xs">Overdue</p><p className="font-bold text-danger">{overdue.length}</p></div>
          <div><p className="text-ink-faint text-xs">Completion rate</p><p className="font-bold text-ink">{completionRate}%</p></div>
          <div><p className="text-ink-faint text-xs">Avg turnaround</p><p className="font-bold text-ink">{avgTurnaroundDays.toFixed(1)}d</p></div>
        </div>
      </GlassCard>

      <GlassCard className="p-6 space-y-2">
        <h3 className="text-sm font-semibold text-ink">Member Reliability</h3>
        {memberReliability.length === 0 && <p className="text-xs text-ink-faint text-center py-3">No assigned tasks yet.</p>}
        {memberReliability.map(m => (
          <div key={m.name} className="flex items-center justify-between p-2.5 rounded-xl border border-hairline">
            <span className="text-sm text-ink">{m.name}</span>
            <span className="text-sm font-bold text-accent">{m.rate}%</span>
          </div>
        ))}
      </GlassCard>

      <GlassCard className="p-6 space-y-2">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><Trophy size={16} className="text-accent" /> Top Earners</h3>
        {top.length === 0 && <p className="text-xs text-ink-faint text-center py-3">No data yet.</p>}
        {top.map((m, i) => (
          <div key={m.id} className="flex items-center justify-between p-2.5 rounded-xl border border-hairline">
            <span className="text-sm font-semibold text-ink">#{i + 1} {m.profile?.name || m.invited_email}</span>
            <span className="text-sm font-bold text-accent">${m.balance.toFixed(2)}</span>
          </div>
        ))}
      </GlassCard>

      {overdue.length > 0 && (
        <GlassCard className="p-6 space-y-2 lg:col-span-2">
          <h3 className="text-sm font-semibold text-ink">Overdue Tasks</h3>
          {overdue.map(t => (
            <div key={t.id} className="p-2.5 rounded-xl border border-danger/30 text-xs">
              <p className="font-semibold text-ink">{t.title}</p>
              <p className="text-ink-faint">Due {formatDue(t.due_date)} · {STATUS_LABEL[t.status]}</p>
            </div>
          ))}
        </GlassCard>
      )}

      <GlassCard className="p-6 space-y-2 lg:col-span-2">
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

// ---------------------------------------------------------------------------
// Team Files — shared browse of the team's Telegram channel. Everyone active
// can view/download everything in it (including task submissions); only
// managers can create folders or upload standalone files. Regular members
// still contribute files via task submission (Tasks section), not here.
// ---------------------------------------------------------------------------

function TeamFilesSection({ team, canManage, cc }: { team: Team; canManage: boolean; cc: CloudClient }) {
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [folders, setFolders] = useState<CloudFolder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    if (!team.telegram_channel_id) { setLoading(false); return; }
    setLoading(true);
    const { files: f, folders: fo } = await cc.fetchChannelFiles(team.telegram_channel_id);
    setFiles(f); setFolders(fo);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [team.telegram_channel_id]);

  const handleCreateFolder = async (name: string, parentId: number | null) => {
    await cc.createChannelFolder(team.telegram_channel_id, name, parentId);
    refresh();
  };

  const handleDeleteFolder = async (folder: CloudFolder) => {
    const result = await swal({ icon: 'warning', title: `Delete folder "${folder.name}"?`, text: 'Files inside will remain, unfiled.', showCancelButton: true, confirmButtonText: 'Delete', confirmButtonColor: '#FF3B30' });
    if (!result.isConfirmed) return;
    await cc.deleteChannelFolder(team.telegram_channel_id, folder);
    refresh();
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    await cc.uploadChannelFile(team.telegram_channel_id, file, currentFolderId);
    setUploading(false);
    swalToast({ icon: 'success', title: 'File uploaded' });
    refresh();
  };

  const handleDownload = async (file: CloudFile) => {
    await cc.downloadTaskAttachment(team.telegram_channel_id, file.id, file.name);
  };

  if (!team.telegram_channel_id) {
    return (
      <GlassCard className="p-8 text-center">
        <p className="text-sm text-ink-muted">No Telegram channel set for this team yet.</p>
        {canManage && <p className="text-xs text-ink-faint mt-1">Set one in the Roster section to enable shared Team Files.</p>}
      </GlassCard>
    );
  }

  if (loading) return null;

  const filesInFolder = files.filter(f => f.folderId === currentFolderId);

  return (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />

      <div className="flex items-center justify-between gap-2">
        <CloudFolders
          folders={folders}
          currentFolderId={currentFolderId}
          onNavigate={setCurrentFolderId}
          onCreateFolder={canManage ? handleCreateFolder : () => {}}
          onDeleteFolder={canManage ? handleDeleteFolder : () => {}}
          fileCountFor={(folderId) => files.filter(f => f.folderId === folderId).length}
        />
      </div>

      {canManage && (
        <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <Upload size={13} /> {uploading ? 'Uploading...' : 'Upload File'}
        </Button>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filesInFolder.length === 0 && (
          <p className="text-xs text-ink-faint text-center py-6 sm:col-span-2 lg:col-span-3">No files in this folder yet.</p>
        )}
        {filesInFolder.map(f => (
          <GlassCard key={f.id} className="p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink truncate">{f.name}</p>
              <p className="text-[10px] text-ink-faint">{cc.formatSize(f.sizeBytes)} · {f.sender}</p>
            </div>
            <button onClick={() => handleDownload(f)} aria-label={`Download ${f.name}`} className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors shrink-0">
              <Download size={14} />
            </button>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat (team channel + DMs)
// ---------------------------------------------------------------------------

function ChatSection({ team, members, myMember }: { team: Team; members: TeamMember[]; myMember: TeamMember | null }) {
  const [mode, setMode] = useState<'team' | 'dm'>('team');
  const [activePartner, setActivePartner] = useState<string | null>(null);

  const partnerMember = members.find(m => m.user_id === activePartner);

  return (
    <GlassCard className="overflow-hidden h-[70vh] flex flex-col">
      <div className="flex items-center gap-2 p-3 border-b border-hairline shrink-0">
        <button
          type="button"
          onClick={() => { setMode('team'); setActivePartner(null); }}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${mode === 'team' ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'}`}
        >
          Team Chat
        </button>
        <button
          type="button"
          onClick={() => setMode('dm')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${mode === 'dm' ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'}`}
        >
          Direct Messages
        </button>
      </div>

      {mode === 'team' && <TeamChatThread team={team} />}
      {mode === 'dm' && !activePartner && <ConversationList team={team} members={members} myMember={myMember} onSelect={setActivePartner} />}
      {mode === 'dm' && activePartner && (
        <DirectThread team={team} partnerId={activePartner} partnerName={partnerMember?.profile?.name || partnerMember?.invited_email || 'Member'} onBack={() => setActivePartner(null)} />
      )}
    </GlassCard>
  );
}

function TeamChatThread({ team }: { team: Team }) {
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [body, setBody] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    listTeamMessages(team.id).then(msgs => { if (mounted) setMessages(msgs); });
    const unsubscribe = subscribeToTeamMessages(team.id, msg => setMessages(prev => [...prev, msg]));
    return () => { mounted = false; unsubscribe(); };
  }, [team.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  const handleSend = async () => {
    if (!body.trim()) return;
    const text = body.trim();
    setBody('');
    await sendTeamMessage(team.id, text);
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.length === 0 && <p className="text-xs text-ink-faint text-center py-6">No messages yet — say hello.</p>}
        {messages.map(m => (
          <div key={m.id} className="p-2.5 rounded-xl bg-ink/[0.03] max-w-md">
            <p className="text-[10px] font-semibold text-accent">{m.sender?.name || 'Member'}</p>
            <p className="text-sm text-ink whitespace-pre-line">{m.body}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="p-3 border-t border-hairline flex gap-2 shrink-0">
        <Input placeholder="Message the team..." value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} className="flex-1" />
        <Button onClick={handleSend}><Send size={14} /></Button>
      </div>
    </>
  );
}

function ConversationList({ team, members, myMember, onSelect }: { team: Team; members: TeamMember[]; myMember: TeamMember | null; onSelect: (userId: string) => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => { setConversations(await listConversations(team.id)); setLoading(false); })();
  }, [team.id]);

  const others = members.filter(m => m.status === 'active' && m.user_id && m.user_id !== myMember?.user_id);
  const contacted = new Set(conversations.map(c => c.otherUserId));

  if (loading) return null;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
      {conversations.map(c => (
        <button key={c.otherUserId} onClick={() => onSelect(c.otherUserId)} className="w-full flex items-center justify-between gap-2 p-2.5 rounded-xl hover:bg-ink/5 transition-colors text-left">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink truncate">{c.otherName}</p>
            <p className="text-xs text-ink-faint truncate">{c.lastMessage}</p>
          </div>
          {c.unread > 0 && <span className="text-[10px] font-bold text-white bg-accent rounded-full w-5 h-5 flex items-center justify-center shrink-0">{c.unread}</span>}
        </button>
      ))}
      {others.filter(m => !contacted.has(m.user_id!)).map(m => (
        <button key={m.id} onClick={() => onSelect(m.user_id!)} className="w-full flex items-center gap-2 p-2.5 rounded-xl hover:bg-ink/5 transition-colors text-left">
          <p className="text-sm text-ink">{m.profile?.name || m.invited_email}</p>
        </button>
      ))}
      {conversations.length === 0 && others.length === 0 && <p className="text-xs text-ink-faint text-center py-6">No teammates to message yet.</p>}
    </div>
  );
}

function DirectThread({ team, partnerId, partnerName, onBack }: { team: Team; partnerId: string; partnerName: string; onBack: () => void }) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [body, setBody] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    listDirectMessages(team.id, partnerId).then(msgs => { if (mounted) setMessages(msgs); });
    markDirectMessagesRead(team.id, partnerId);
    const unsubscribe = subscribeToDirectMessages(team.id, msg => {
      if (msg.sender_id === partnerId || msg.receiver_id === partnerId) setMessages(prev => [...prev, msg]);
    });
    return () => { mounted = false; unsubscribe(); };
  }, [team.id, partnerId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  const handleSend = async () => {
    if (!body.trim()) return;
    const text = body.trim();
    setBody('');
    await sendDirectMessage(team.id, partnerId, text);
  };

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline shrink-0">
        <button onClick={onBack} aria-label="Back" className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors">
          <ArrowLeft size={14} />
        </button>
        <p className="text-sm font-semibold text-ink">{partnerName}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map(m => (
          <div key={m.id} className={`p-2.5 rounded-xl max-w-md ${m.sender_id === partnerId ? 'bg-ink/[0.03]' : 'bg-accent-soft ml-auto'}`}>
            <p className="text-sm text-ink whitespace-pre-line">{m.body}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="p-3 border-t border-hairline flex gap-2 shrink-0">
        <Input placeholder="Type a message..." value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} className="flex-1" />
        <Button onClick={handleSend}><Send size={14} /></Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Admin — team settings, broadcast, danger zone (owner only)
// ---------------------------------------------------------------------------

function AdminSection({ team, members, onChanged }: { team: Team; members: TeamMember[]; onChanged: () => void }) {
  const [name, setName] = useState(team.name);
  const [transferTo, setTransferTo] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);

  const handleCreateInviteLink = async () => {
    setCreatingInvite(true);
    const { token, error } = await createInviteToken(team.id);
    setCreatingInvite(false);
    if (error || !token) { swal({ icon: 'error', title: 'Could not create invite link', text: error || 'Unknown error' }); return; }
    const link = `${window.location.origin}${window.location.pathname}?join=${token.token}`;
    await navigator.clipboard.writeText(link);
    swalToast({ icon: 'success', title: 'Invite link copied to clipboard' });
  };

  const handleTransfer = async () => {
    if (!transferTo) return;
    const result = await swal({
      icon: 'warning',
      title: 'Propose ownership transfer?',
      text: 'The nominee must accept before ownership actually changes.',
      showCancelButton: true,
      confirmButtonText: 'Send Offer',
    });
    if (!result.isConfirmed) return;
    setTransferring(true);
    const error = await requestOwnerTransfer(team.id, transferTo);
    setTransferring(false);
    if (error) { swal({ icon: 'error', title: 'Could not send offer', text: error }); return; }
    swalToast({ icon: 'success', title: 'Transfer offer sent' });
    setTransferTo('');
  };
  const [description, setDescription] = useState(team.description);
  const [payNote, setPayNote] = useState(team.pay_note);
  const [visibility, setVisibility] = useState<'public' | 'private'>(team.visibility);
  const [joinAdUrl, setJoinAdUrl] = useState(team.join_ad_url || '');
  const [tags, setTags] = useState<string[]>(team.tags || []);
  const [savingSettings, setSavingSettings] = useState(false);
  const joinAdInputRef = useRef<HTMLInputElement>(null);

  const toggleTag = (tag: string) => {
    setTags(t => t.includes(tag) ? t.filter(x => x !== tag) : [...t, tag]);
  };

  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);

  const [deleting, setDeleting] = useState(false);

  const handleSaveSettings = async () => {
    if (!name.trim()) { swal({ icon: 'error', title: 'Team name is required' }); return; }
    setSavingSettings(true);
    let joinAdUploaded = joinAdUrl;
    if (joinAdUrl.startsWith('data:')) {
      const uploaded = await uploadImageToStorage(joinAdUrl, `teams/${team.id}/join-ad.jpg`);
      if (uploaded) joinAdUploaded = uploaded;
    }
    const error = await updateTeamSettings(team.id, { name: name.trim(), description: description.trim(), pay_note: payNote.trim(), visibility, join_ad_url: joinAdUploaded || null, tags });
    setSavingSettings(false);
    if (error) { swal({ icon: 'error', title: 'Could not save', text: error }); return; }
    swalToast({ icon: 'success', title: 'Team settings saved' });
    onChanged();
  };

  const handleBroadcast = async () => {
    if (!broadcastTitle.trim() || !broadcastBody.trim()) { swal({ icon: 'error', title: 'Title and message required' }); return; }
    setBroadcasting(true);
    const error = await broadcastToTeam(team.id, broadcastTitle.trim(), broadcastBody.trim());
    setBroadcasting(false);
    if (error) { swal({ icon: 'error', title: 'Could not broadcast', text: error }); return; }
    swalToast({ icon: 'success', title: 'Broadcast sent to every member' });
    setBroadcastTitle(''); setBroadcastBody('');
  };

  const handleDeleteTeam = async () => {
    const result = await swal({
      icon: 'warning',
      title: `Permanently delete "${team.name}"?`,
      text: 'This removes every member, task, transaction, and message for this team. This cannot be undone.',
      showCancelButton: true,
      confirmButtonText: 'Delete Team',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    setDeleting(true);
    const error = await deleteTeam(team.id);
    setDeleting(false);
    if (error) { swal({ icon: 'error', title: 'Could not delete team', text: error }); return; }
    swalToast({ icon: 'success', title: 'Team deleted' });
    onChanged();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <GlassCard className="p-6 space-y-3">
        <h3 className="text-sm font-semibold text-ink">Team Settings</h3>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Name</label>
          <Input value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Description</label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Usual Pay</label>
          <Input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="e.g. $10–20 per task" />
        </div>
        <div className="flex items-center justify-between p-3 rounded-xl border border-hairline">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            {visibility === 'public' ? <Globe size={14} className="text-accent" /> : <Lock size={14} className="text-ink-faint" />}
            {visibility === 'public' ? 'Public — listed in directory' : 'Private — join by ID only'}
          </div>
          <Switch checked={visibility === 'public'} onChange={v => setVisibility(v ? 'public' : 'private')} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Specialty Tags</label>
          <div className="flex flex-wrap gap-1.5">
            {JOB_TITLES.map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                  tags.includes(tag) ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Join Ad Image</label>
          <p className="text-[10px] text-ink-faint">Shown at the top of your team's card in the public directory</p>
          <button
            type="button"
            onClick={() => joinAdInputRef.current?.click()}
            className="w-full aspect-[16/6] rounded-xl overflow-hidden border border-dashed border-hairline flex items-center justify-center bg-ink/[0.02] hover:bg-ink/[0.05] transition-colors"
          >
            {joinAdUrl ? <img src={joinAdUrl} alt="Join ad" className="w-full h-full object-cover" /> : <ImagePlus size={20} className="text-ink-faint" />}
          </button>
          <input ref={joinAdInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readAvatarFile(f, setJoinAdUrl, 480); }} />
        </div>
        <Button className="w-full" onClick={handleSaveSettings} disabled={savingSettings}>{savingSettings ? 'Saving...' : 'Save Settings'}</Button>
      </GlassCard>

      <GlassCard className="p-6 space-y-3">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><Megaphone size={16} className="text-accent" /> Broadcast to Everyone</h3>
        <Input placeholder="Announcement title" value={broadcastTitle} onChange={e => setBroadcastTitle(e.target.value)} />
        <Textarea placeholder="Message..." value={broadcastBody} onChange={e => setBroadcastBody(e.target.value)} rows={4} />
        <Button className="w-full" onClick={handleBroadcast} disabled={broadcasting}>{broadcasting ? 'Sending...' : 'Send to All Members'}</Button>
      </GlassCard>

      <GlassCard className="p-6 space-y-3">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><LinkIcon size={16} className="text-accent" /> Invite Link</h3>
        <p className="text-xs text-ink-muted">Anyone who opens the link can request to join — you still approve or reject each request.</p>
        <Button className="w-full" variant="secondary" onClick={handleCreateInviteLink} disabled={creatingInvite}>{creatingInvite ? 'Creating...' : 'Copy Invite Link'}</Button>
      </GlassCard>

      <GlassCard className="p-6 space-y-3">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><Crown size={16} className="text-accent" /> Transfer Ownership</h3>
        <p className="text-xs text-ink-muted">The nominee must accept before ownership changes — this doesn't happen instantly.</p>
        <select
          value={transferTo}
          onChange={e => setTransferTo(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-hairline bg-transparent text-sm text-ink"
        >
          <option value="">Select a member...</option>
          {members.filter(m => m.status === 'active' && m.user_id && m.user_id !== team.owner_id).map(m => (
            <option key={m.id} value={m.user_id!}>{m.profile?.name || m.invited_email}</option>
          ))}
        </select>
        <Button className="w-full" onClick={handleTransfer} disabled={transferring || !transferTo}>{transferring ? 'Sending...' : 'Propose Transfer'}</Button>
      </GlassCard>

      <GlassCard className="p-6 space-y-3 border-danger/30 lg:col-span-2">
        <h3 className="text-sm font-semibold text-danger flex items-center gap-2"><AlertTriangle size={16} /> Danger Zone</h3>
        <p className="text-xs text-ink-muted">Deleting the team removes all members, tasks, transactions, and messages permanently.</p>
        <Button variant="danger" onClick={handleDeleteTeam} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete Team'}</Button>
      </GlassCard>
    </div>
  );
}
