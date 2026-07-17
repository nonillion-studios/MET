import { useEffect, useRef, useState } from 'react';
import {
  Users, ImagePlus, Plus, Mail, Check, X, Crown, ShieldCheck, ArrowUpCircle, ArrowDownCircle, UserMinus,
  Send, ListTodo, Paperclip, CalendarClock, Trash2, Wallet, Flame, Trophy, BarChart3, Link as LinkIcon,
  ThumbsUp, ThumbsDown, Pencil, LogOut, Clock3, PiggyBank, Home, MessageCircle, Globe, Lock, ArrowLeft, UserPlus, Hash,
  Megaphone, AlertTriangle, ChevronDown,
} from 'lucide-react';
import { GlassCard, Button, Input, Textarea, Modal, Switch, SkeletonCard, SkeletonRow } from './ui';
import { swal, swalToast, confirmWithCaptcha } from '../lib/swalTheme';
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
  Task, TaskPriority, TaskStatus, TaskAttachment, createTaskWithWorkflow, listTeamTasks, listMyTasks, deleteTask, attachFileToTask, listTaskAttachments,
  setTeamTelegramChannel, acceptTask, declineTask, submitTask, approveTask, rejectSubmission,
  checkIn, setMemberActive, expireStaleOffers, reassignMemberTasks, notifyUpcomingTaskDeadlines, spawnRecurringTasks,
  TaskChecklistItem, listChecklistItems, addChecklistItem, toggleChecklistItem, deleteChecklistItem,
  TaskHistoryEntry, listTaskHistory,
  TaskTimeEntry, listTimeEntries, getMyOpenTimeEntry, startTimer, stopTimer, totalTrackedMs,
  listDependencies, addDependency, removeDependency,
} from '../lib/tasks';
import { TaskComment, listTaskComments, postTaskComment, subscribeToTaskComments } from '../lib/taskComments';
import { TaskTemplate, listTemplates, saveAsTemplate } from '../lib/taskTemplates';
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
  editTeamMessage, deleteTeamMessage, pinTeamMessage, editDirectMessage, deleteDirectMessage,
  listReactions, subscribeToReactions, toggleReaction, MessageReaction,
  parseMentions, subscribeToTyping, markTeamChatRead, getTeamChatUnreadCount,
} from '../lib/chat';
import { notify } from '../lib/notifications';
import { requestOwnerTransfer, decideOwnerTransfer, getMyPendingOwnerTransfers, OwnerTransferRequest } from '../lib/ownerTransfer';
import { listTeamBadges, TeamBadge, listMemberBadges, MemberBadge } from '../lib/teamBadges';
import { getCurrentSeasonLeaderboard, closeCurrentSeason, SeasonLeaderboardRow } from '../lib/seasons';
import { exportTeamReportDocx } from '../lib/teamReport';
import type { CloudClient, CloudFile, CloudFolder, CloudFileComment } from '../lib/cloudClient';
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
  canManage: boolean; // owner or leader (blanket — invites, telegram channel)
  canReviewTasks: boolean;
  canManageBank: boolean;
  canManageJoinRequests: boolean;
  canManageVacations: boolean;
  canManageTasks: boolean; // delegable, in addition to blanket leader access
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
    canManageTasks: canManage || !!myMember?.can_manage_tasks,
  };

  const visibleSections = SECTIONS.filter(s => !s.forOwnerOnly || isOwner);
  const [activeSection, setActiveSection] = useState<SectionId>('dashboard');

  return (
    <div className="space-y-10">
      <nav className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 backdrop-blur-xl bg-surface/80 border-b border-hairline flex items-center gap-1.5 overflow-x-auto">
        {visibleSections.map(s => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSection(s.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                activeSection === s.id ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-accent-soft hover:text-accent'
              }`}
            >
              <Icon size={13} /> {s.label}
            </button>
          );
        })}
      </nav>

      {activeSection === 'dashboard' && (
        <div>
          <SectionHeader icon={Home} title="Dashboard" description={SECTION_DESCRIPTIONS.dashboard} />
          <DashboardSection team={team} myMember={myMember} canManage={canManage} members={members} onChanged={onChanged} />
        </div>
      )}

      {activeSection === 'tasks' && (
        <div>
          <SectionHeader icon={ListTodo} title="Tasks" description={SECTION_DESCRIPTIONS.tasks} />
          <TasksSection team={team} members={members} canManageTasks={perms.canManageTasks} canReviewTasks={perms.canReviewTasks} myMember={myMember} cc={cc} />
        </div>
      )}

      {activeSection === 'bank' && (
        <div>
          <SectionHeader icon={Wallet} title="Bank" description={SECTION_DESCRIPTIONS.bank} />
          <BankTab team={team} members={members} myMember={myMember} canManageBank={perms.canManageBank} />
        </div>
      )}

      {activeSection === 'chat' && (
        <div>
          <SectionHeader icon={MessageCircle} title="Chat" description={SECTION_DESCRIPTIONS.chat} />
          <ChatSection team={team} members={members} myMember={myMember} isOwner={isOwner} canManage={canManage} onChanged={onChanged} cc={cc} />
        </div>
      )}

      {activeSection === 'files' && (
        <div>
          <SectionHeader icon={FolderIcon} title="Files" description={SECTION_DESCRIPTIONS.files} />
          <TeamFilesSection team={team} canManage={canManage} cc={cc} />
        </div>
      )}

      {activeSection === 'requests' && (
        <div>
          <SectionHeader icon={CalendarClock} title="Requests" description={SECTION_DESCRIPTIONS.requests} />
          <RequestsTab team={team} myMember={myMember} canManageVacations={perms.canManageVacations} canManageJoinRequests={perms.canManageJoinRequests} onChanged={onChanged} />
        </div>
      )}

      {activeSection === 'roster' && (
        <div>
          <SectionHeader icon={Users} title="Roster" description={SECTION_DESCRIPTIONS.roster} />
          <TeamRoster team={team} members={members} isOwner={isOwner} canManageMembers={canManage} onChanged={onChanged} />
        </div>
      )}

      {activeSection === 'analytics' && (
        <div>
          <SectionHeader icon={BarChart3} title="Analytics" description={SECTION_DESCRIPTIONS.analytics} />
          <AnalyticsSection team={team} members={members} />
        </div>
      )}

      {activeSection === 'admin' && isOwner && (
        <div>
          <SectionHeader icon={ShieldCheck} title="Admin" description={SECTION_DESCRIPTIONS.admin} />
          <AdminSection team={team} members={members} onChanged={onChanged} />
        </div>
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

      <TopPerformersCard team={team} members={members} />

      {!myMember && !canManage && (
        <GlassCard className="p-8 text-center md:col-span-2">
          <p className="text-sm text-ink-muted">No personal dashboard for this account yet.</p>
        </GlassCard>
      )}
    </div>
  );
}

function TopPerformersCard({ team, members }: { team: Team; members: TeamMember[] }) {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => { listTeamTasks(team.id).then(setTasks); }, [team.id]);

  const jobs = Array.from(new Set(members.map(m => m.job_title).filter((j): j is JobTitle => !!j)));
  const doneTasks = tasks.filter(t => t.status === 'done' && t.assignee_id);

  const rankingByJob = jobs.map(job => {
    const counts = new Map<string, number>();
    for (const t of doneTasks) {
      if (!t.job_types.includes(job)) continue;
      counts.set(t.assignee_id, (counts.get(t.assignee_id) || 0) + 1);
    }
    const ranked = Array.from(counts.entries())
      .map(([userId, count]) => ({ userId, count, member: members.find(m => m.user_id === userId) }))
      .filter(r => r.member)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return { job, ranked };
  }).filter(r => r.ranked.length > 0);

  if (rankingByJob.length === 0) return null;

  const medalColor = ['text-amber-500', 'text-slate-400', 'text-orange-700'];

  return (
    <GlassCard className="p-6 md:col-span-2">
      <h3 className="text-sm font-semibold text-ink mb-4 flex items-center gap-1.5"><Trophy size={14} className="text-accent" /> Top performers by job</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rankingByJob.map(({ job, ranked }) => (
          <div key={job} className="space-y-1.5">
            <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wide">{job}</p>
            <div className="flex flex-col gap-1">
              {ranked.map((r, i) => (
                <div
                  key={r.userId}
                  className="flex items-center gap-2 p-1.5 rounded-lg bg-ink/[0.03] transition-all duration-500 ease-out"
                  style={{ order: i }}
                >
                  <span className={`text-xs font-bold w-4 shrink-0 ${medalColor[i] || 'text-ink-faint'}`}>#{i + 1}</span>
                  <ChatAvatar name={r.member?.profile?.name || r.member?.invited_email || 'Member'} avatar={r.member?.profile?.avatar} size={22} />
                  <span className="text-xs text-ink truncate flex-1">{r.member?.profile?.name || r.member?.invited_email}</span>
                  <span className="text-[10px] font-bold text-accent shrink-0">{r.count}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
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

const PERM_TOGGLES: { key: 'can_review_tasks' | 'can_manage_bank' | 'can_manage_join_requests' | 'can_manage_vacations' | 'can_manage_tasks'; label: string }[] = [
  { key: 'can_review_tasks', label: 'Review tasks' },
  { key: 'can_manage_bank', label: 'Manage bank' },
  { key: 'can_manage_join_requests', label: 'Manage join requests' },
  { key: 'can_manage_vacations', label: 'Manage vacations' },
  { key: 'can_manage_tasks', label: 'Create/manage tasks' },
];

function EditMemberModal({ member, onClose, onSaved }: { member: TeamMember; onClose: () => void; onSaved: () => void }) {
  const [jobTitle, setJobTitle] = useState<JobTitle | ''>(member.job_title || '');
  const [priority, setPriority] = useState(String(member.priority ?? ''));
  const [balance, setBalance] = useState(String(member.balance ?? 0));
  const [customTitle, setCustomTitle] = useState(member.custom_title || '');
  const [customPerms, setCustomPerms] = useState<string[]>(member.custom_permissions || []);
  const [customPermInput, setCustomPermInput] = useState('');
  const [perms, setPerms] = useState({
    can_review_tasks: member.can_review_tasks,
    can_manage_bank: member.can_manage_bank,
    can_manage_join_requests: member.can_manage_join_requests,
    can_manage_vacations: member.can_manage_vacations,
    can_manage_tasks: member.can_manage_tasks,
  });
  const [saving, setSaving] = useState(false);

  const addCustomPerm = () => {
    const p = customPermInput.trim();
    if (p && !customPerms.includes(p)) setCustomPerms(prev => [...prev, p]);
    setCustomPermInput('');
  };

  const handleSave = async () => {
    setSaving(true);
    const error = await updateMemberFields(member.id, {
      job_title: (jobTitle || null) as JobTitle | null,
      priority: priority ? Number(priority) : null,
      balance: Number(balance) || 0,
      custom_title: customTitle.trim() || null,
      custom_permissions: customPerms,
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
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Display title (e.g. "Bank Officer")</label>
          <Input value={customTitle} onChange={e => setCustomTitle(e.target.value)} placeholder="Optional" />
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
            <div className="pt-1.5 space-y-1.5">
              <label className="text-[11px] text-ink-muted">Custom permission tags</label>
              <div className="flex gap-2">
                <Input placeholder="e.g. can_edit_cloud" value={customPermInput} onChange={e => setCustomPermInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCustomPerm())} className="flex-1" />
                <Button type="button" variant="secondary" size="sm" onClick={addCustomPerm}>Add</Button>
              </div>
              {customPerms.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {customPerms.map(p => (
                    <span key={p} className="text-[10px] font-semibold px-2 py-1 rounded-full bg-ink/5 text-ink-muted flex items-center gap-1">
                      {p} <button type="button" onClick={() => setCustomPerms(prev => prev.filter(x => x !== p))} className="hover:text-danger">✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
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
                    {m.custom_title && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-accent-soft text-accent shrink-0">{m.custom_title}</span>}
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

  if (loading) {
    return (
      <SkeletonCard className="max-w-md h-72" />
    );
  }

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

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <SkeletonCard className="h-40" />
          <SkeletonCard className="h-40" />
        </div>
        <SkeletonCard className="h-52" />
      </div>
    );
  }

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

  if (loading) {
    return (
      <GlassCard className="overflow-hidden divide-y divide-hairline">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
      </GlassCard>
    );
  }
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

  if (loading) {
    return (
      <GlassCard className="overflow-hidden divide-y divide-hairline">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
      </GlassCard>
    );
  }

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

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonCard className="h-24" />
        <div className="grid sm:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {sortedTeams.map(t => (
              <GlassCard key={t.id} className="overflow-hidden flex flex-col w-full">
                {t.join_ad_url && (
                  <div className="w-full overflow-hidden border-b border-hairline bg-ink/[0.04] flex items-center justify-center">
                    <img src={t.join_ad_url} alt="" className="w-full max-h-56 object-contain" />
                  </div>
                )}
                <div className="p-4 flex items-center gap-3 border-b border-hairline bg-ink/[0.02]">
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-accent-soft border border-hairline shrink-0 flex items-center justify-center">
                    {t.logo ? <img src={t.logo} alt={t.name} className="w-full h-full object-cover" /> : <Users size={20} className="text-accent" />}
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-semibold text-ink truncate">{t.name}</p>
                    <p className="text-[10px] text-ink-faint">{t.member_count} member{t.member_count === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <div className="p-4 space-y-2 text-left flex-1 flex flex-col">
                  {t.description && <p className="text-xs text-ink-muted line-clamp-2">{t.description}</p>}
                  {t.pay_note && <p className="text-xs font-semibold text-accent">{t.pay_note}</p>}
                  {t.tags && t.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {t.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-ink/5 text-ink-muted">{tag}</span>
                      ))}
                    </div>
                  )}
                  {t.badges && t.badges.length > 0 && (
                    <div className="flex flex-wrap gap-1">
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

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: 'bg-danger text-white',
  high: 'bg-orange-500 text-white',
  normal: 'bg-ink/10 text-ink-muted',
  low: 'bg-ink/5 text-ink-faint',
};

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function TaskAttachmentControl({ task, team, cc, onChanged }: { task: Task; team: Team; cc: CloudClient; onChanged: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);

  const reload = () => { listTaskAttachments(task.id).then(setAttachments); };
  useEffect(reload, [task.id]);

  const submission = attachments.find(a => a.kind === 'submission');

  const handleAttach = async (file: File) => {
    if (!team.telegram_channel_id) {
      swal({ icon: 'error', title: 'No Channel Set', text: 'Ask your leader to set the team Telegram channel first.' });
      return;
    }
    setBusy(true);
    const result = await cc.uploadTaskAttachment(team.telegram_channel_id, file);
    if (result) {
      await attachFileToTask(task.id, result, 'submission');
      await submitTask(task.id, 'file', result.name);
    }
    setBusy(false);
    if (result) { swalToast({ icon: 'success', title: 'File submitted' }); reload(); onChanged(); }
  };

  const handleDownload = (a: TaskAttachment) => {
    cc.downloadTaskAttachment(team.telegram_channel_id, a.msg_id, a.name);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {task.attachment_msg_id && (
        <button onClick={() => cc.downloadTaskAttachment(team.telegram_channel_id, task.attachment_msg_id!, task.attachment_name || 'attachment')} className="text-[11px] text-accent hover:text-ink flex items-center gap-1 font-semibold">
          <Paperclip size={11} /> {task.attachment_name || 'Reference'}
        </button>
      )}
      {attachments.map(a => (
        <button key={a.id} onClick={() => handleDownload(a)} className="text-[11px] text-accent hover:text-ink flex items-center gap-1 font-semibold">
          <Paperclip size={11} /> {a.kind === 'reference' ? 'Reference: ' : ''}{a.name}
        </button>
      ))}
      {!submission && (
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
      )}
    </div>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{ msgId: number; name: string; size: number } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all');
  const [sortBy, setSortBy] = useState<'created' | 'due' | 'priority'>('created');
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [recurrence, setRecurrence] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [assignMode, setAssignMode] = useState<'auto' | 'manual'>('auto');
  const [assigneeId, setAssigneeId] = useState('');
  const [offerExpiresAt, setOfferExpiresAt] = useState('');

  useEffect(() => { if (canManageTasks) listTemplates(team.id).then(setTemplates); }, [team.id, canManageTasks]);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find(x => x.id === id);
    if (!t) return;
    setTitle(t.title); setDescription(t.description); setJobTypes(t.job_types);
    setReward(t.reward != null ? String(t.reward) : ''); setPriority(t.priority); setTags(t.tags);
  };

  const handleSaveTemplate = async () => {
    if (!title.trim()) { swal({ icon: 'error', title: 'Add a title first' }); return; }
    const { value: name } = await swal({ title: 'Template name', input: 'text', showCancelButton: true });
    if (!name) return;
    const error = await saveAsTemplate({ teamId: team.id, name, title: title.trim(), description: description.trim(), jobTypes, reward: reward ? Number(reward) : null, priority, tags });
    if (error) { swal({ icon: 'error', title: 'Could not save template', text: error }); return; }
    swalToast({ icon: 'success', title: 'Template saved' });
    listTemplates(team.id).then(setTemplates);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput('');
  };

  const handleAttachReference = async (file: File) => {
    if (!team.telegram_channel_id) {
      swal({ icon: 'error', title: 'No Channel Set', text: 'Set the team Telegram channel first.' });
      return;
    }
    if (!cc.isConnected) {
      swal({ icon: 'info', title: 'Connect Telegram', text: 'Connect your Telegram account in Cloud Storage to attach files.' });
      return;
    }
    setAttaching(true);
    const result = await cc.uploadTaskAttachment(team.telegram_channel_id, file);
    setAttaching(false);
    if (result) setAttachment(result);
  };

  const refresh = async () => {
    setLoading(true);
    await expireStaleOffers(team.id);
    await notifyUpcomingTaskDeadlines(team.id);
    if (canManageTasks) await spawnRecurringTasks(team.id);
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
    if (assignMode === 'manual' && !assigneeId) {
      swal({ icon: 'error', title: 'Pick an assignee', text: 'Choose a member or switch back to auto-assign.' });
      return;
    }
    setCreating(true);
    const mentionedUserIds = parseMentions(description, members);
    const error = await createTaskWithWorkflow({
      teamId: team.id, title: title.trim(), description: description.trim(),
      jobTypes, dueDate: dueDate || null, reward: reward ? Number(reward) : undefined,
      attachment: attachment ?? undefined, priority, tags, recurrence,
      assigneeId: assignMode === 'manual' ? assigneeId : null,
      offerExpiresAt: offerExpiresAt ? new Date(offerExpiresAt).toISOString() : null,
      mentionedUserIds,
    });
    setCreating(false);
    if (error) { swal({ icon: 'error', title: 'Could not create task', text: error }); return; }
    setTitle(''); setDescription(''); setJobTypes([]); setDueDate(''); setReward(''); setAttachment(null); setPriority('normal'); setTags([]); setTagInput(''); setTemplateId(''); setRecurrence('none'); setAssignMode('auto'); setAssigneeId(''); setOfferExpiresAt('');
    swalToast({ icon: 'success', title: assignMode === 'manual' ? 'Task created and assigned' : 'Task created and auto-assigned' });
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

  let filteredTasks = tasks;
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filteredTasks = filteredTasks.filter(t => t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || t.tags?.some(tag => tag.toLowerCase().includes(q)));
  }
  if (statusFilter !== 'all') filteredTasks = filteredTasks.filter(t => t.status === statusFilter);
  if (priorityFilter !== 'all') filteredTasks = filteredTasks.filter(t => t.priority === priorityFilter);
  filteredTasks = [...filteredTasks].sort((a, b) => {
    if (sortBy === 'due') return (a.due_date ? new Date(a.due_date).getTime() : Infinity) - (b.due_date ? new Date(b.due_date).getTime() : Infinity);
    if (sortBy === 'priority') return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const handleDelete = async (id: string) => {
    const result = await swal({ icon: 'warning', title: 'Delete this task?', showCancelButton: true, confirmButtonText: 'Delete', confirmButtonColor: '#FF3B30' });
    if (!result.isConfirmed) return;
    setBusyId(id);
    const error = await deleteTask(id);
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not delete task', text: error }); return; }
    refresh();
  };

  if (loading) {
    return (
      <GlassCard className="overflow-hidden max-w-2xl divide-y divide-hairline">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
      </GlassCard>
    );
  }

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
            {templates.length > 0 && (
              <select value={templateId} onChange={e => applyTemplate(e.target.value)} className="w-full text-xs px-2 py-1.5 rounded-lg border border-hairline bg-transparent text-ink">
                <option value="">Start from a template...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
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
              <div>
                <label className="text-[9px] font-semibold text-ink-faint uppercase tracking-wide px-1">Deadline</label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <Input type="number" step="0.01" placeholder="Reward ($, optional)" value={reward} onChange={(e) => setReward(e.target.value)} className="mt-auto" />
            </div>
            <div>
              <label className="text-[9px] font-semibold text-ink-faint uppercase tracking-wide px-1">Offer expiry (auto-decline if unaccepted)</label>
              <Input type="datetime-local" value={offerExpiresAt} onChange={(e) => setOfferExpiresAt(e.target.value)} />
            </div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setAssignMode('auto')} className={`flex-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg border transition-colors ${assignMode === 'auto' ? 'bg-accent text-white border-accent' : 'border-hairline text-ink-muted hover:border-accent/40'}`}>Auto-assign</button>
              <button type="button" onClick={() => setAssignMode('manual')} className={`flex-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg border transition-colors ${assignMode === 'manual' ? 'bg-accent text-white border-accent' : 'border-hairline text-ink-muted hover:border-accent/40'}`}>Choose member</button>
            </div>
            {assignMode === 'manual' && (
              <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className="w-full text-xs px-2 py-1.5 rounded-lg border border-hairline bg-transparent text-ink">
                <option value="">Select a member...</option>
                {members.filter(m => m.status === 'active' && m.user_id).map(m => (
                  <option key={m.id} value={m.user_id!}>{m.profile?.name || m.invited_email}</option>
                ))}
              </select>
            )}
            <div className="flex flex-wrap gap-1.5">
              {(['low', 'normal', 'high', 'urgent'] as TaskPriority[]).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors capitalize ${priority === p ? PRIORITY_COLORS[p] + ' border-transparent' : 'border-hairline text-ink-muted hover:border-accent/40'}`}
                >
                  {p}
                </button>
              ))}
            </div>
            <select value={recurrence} onChange={e => setRecurrence(e.target.value as typeof recurrence)} className="w-full text-xs px-2 py-1.5 rounded-lg border border-hairline bg-transparent text-ink">
              <option value="none">Does not repeat</option>
              <option value="daily">Repeats daily</option>
              <option value="weekly">Repeats weekly</option>
              <option value="monthly">Repeats monthly</option>
            </select>
            <div className="flex gap-2">
              <Input placeholder="Add a tag..." value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} className="flex-1" />
              <Button type="button" variant="secondary" size="sm" onClick={addTag}>Add</Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map(t => (
                  <span key={t} className="text-[10px] font-semibold px-2 py-1 rounded-full bg-ink/5 text-ink-muted flex items-center gap-1">
                    {t} <button type="button" onClick={() => setTags(prev => prev.filter(x => x !== t))} className="hover:text-danger">✕</button>
                  </span>
                ))}
              </div>
            )}
            <input ref={attachmentInputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAttachReference(f); }} />
            {attachment ? (
              <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted px-1">
                <span className="flex items-center gap-1 truncate"><Paperclip size={11} /> {attachment.name}</span>
                <button type="button" onClick={() => setAttachment(null)} className="text-ink-faint hover:text-danger shrink-0">Remove</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={attaching}
                className="text-[11px] text-ink-faint hover:text-accent flex items-center gap-1 font-semibold px-1"
              >
                <Paperclip size={11} /> {attaching ? 'Uploading...' : 'Attach reference file (optional)'}
              </button>
            )}
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={creating} className="flex-1">
                <Plus size={14} /> {creating ? 'Creating...' : 'Create Task'}
              </Button>
              <Button variant="secondary" onClick={handleSaveTemplate} disabled={creating}>Save as Template</Button>
            </div>
          </div>
        )}

        <div className="space-y-2 pb-3 border-b border-hairline">
          <Input placeholder="Search tasks..." value={search} onChange={e => setSearch(e.target.value)} />
          <div className="flex flex-wrap gap-1.5 items-center">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as TaskStatus | 'all')} className="text-[11px] px-2 py-1 rounded-lg border border-hairline bg-transparent text-ink">
              <option value="all">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as TaskPriority | 'all')} className="text-[11px] px-2 py-1 rounded-lg border border-hairline bg-transparent text-ink">
              <option value="all">All priorities</option>
              {(['urgent', 'high', 'normal', 'low'] as TaskPriority[]).map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as 'created' | 'due' | 'priority')} className="text-[11px] px-2 py-1 rounded-lg border border-hairline bg-transparent text-ink">
              <option value="created">Sort: Newest</option>
              <option value="due">Sort: Due date</option>
              <option value="priority">Sort: Priority</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          {filteredTasks.length === 0 && <p className="text-xs text-ink-faint text-center py-3">{canManageTasks ? 'No tasks match.' : 'No tasks assigned to you.'}</p>}
          {filteredTasks.map(t => {
            const isMine = myMember && t.assignee_id === myMember.user_id;
            return (
              <div key={t.id} className={`p-3 rounded-xl border transition-colors ${t.status === 'done' || t.status === 'cancelled' ? 'border-hairline bg-ink/[0.02]' : 'border-hairline hover:border-accent/20'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className={`text-sm font-semibold truncate ${t.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'}`}>{t.title}</p>
                      {t.priority !== 'normal' && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>}
                    </div>
                    {t.description && <p className="text-xs text-ink-muted mt-0.5 whitespace-pre-line">{t.description}</p>}
                    <p className="text-[10px] text-ink-faint mt-1 flex flex-wrap items-center gap-x-2">
                      {canManageTasks && <span>{t.assignee?.name || 'Unassigned'}</span>}
                      {t.reward != null && <span>${t.reward}</span>}
                      {t.job_types?.length > 0 && <span>{t.job_types.join(', ')}</span>}
                    </p>
                    {t.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {t.tags.map(tag => <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-ink/5 text-ink-faint">{tag}</span>)}
                      </div>
                    )}
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
                    {t.status !== 'todo' && <TaskAttachmentControl task={t} team={team} cc={cc} onChanged={refresh} />}
                    {t.status === 'todo' && t.attachment_msg_id && (
                      <button onClick={() => cc.downloadTaskAttachment(team.telegram_channel_id, t.attachment_msg_id!, t.attachment_name || 'attachment')} className="text-[11px] text-accent hover:text-ink flex items-center gap-1 font-semibold">
                        <Paperclip size={11} /> {t.attachment_name || 'Reference'}
                      </button>
                    )}
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

                <button
                  onClick={() => setExpandedId(id => id === t.id ? null : t.id)}
                  className="text-[10px] text-ink-faint hover:text-accent font-semibold mt-2"
                >
                  {expandedId === t.id ? 'Hide details' : 'Checklist, comments & history'}
                </button>
                {expandedId === t.id && <TaskDetailPanel task={t} canManage={canManageTasks || !!isMine} allTasks={tasks} />}
              </div>
            );
          })}
        </div>
      </div>
    </GlassCard>
  );
}

function TaskDetailPanel({ task, canManage, allTasks }: { task: Task; canManage: boolean; allTasks: Task[] }) {
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [history, setHistory] = useState<TaskHistoryEntry[]>([]);
  const [timeEntries, setTimeEntries] = useState<TaskTimeEntry[]>([]);
  const [openEntry, setOpenEntry] = useState<TaskTimeEntry | null>(null);
  const [, forceTick] = useState(0);
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [depPick, setDepPick] = useState('');

  const reload = () => {
    listChecklistItems(task.id).then(setChecklist);
    listTaskComments(task.id).then(setComments);
    listTaskHistory(task.id).then(setHistory);
    listTimeEntries(task.id).then(setTimeEntries);
    getMyOpenTimeEntry(task.id).then(setOpenEntry);
    listDependencies(task.id).then(rows => setDependsOn(rows.map(r => r.depends_on_task_id)));
  };

  const handleAddDependency = async () => {
    if (!depPick) return;
    await addDependency(task.id, depPick);
    setDepPick('');
    reload();
  };
  useEffect(() => {
    reload();
    const unsubscribe = subscribeToTaskComments(task.id, c => setComments(prev => upsertById(prev, c)));
    return unsubscribe;
  }, [task.id]);

  useEffect(() => {
    if (!openEntry) return;
    const interval = setInterval(() => forceTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [openEntry]);

  const handleToggleTimer = async () => {
    if (openEntry) {
      await stopTimer(openEntry.id);
    } else {
      await startTimer(task.id);
    }
    reload();
  };

  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
  };

  const handleAddItem = async () => {
    if (!newItem.trim()) return;
    await addChecklistItem(task.id, newItem.trim(), checklist.length);
    setNewItem('');
    reload();
  };

  const handlePostComment = async () => {
    if (!commentBody.trim()) return;
    await postTaskComment(task.id, commentBody.trim());
    setCommentBody('');
  };

  const done = checklist.filter(c => c.done).length;

  return (
    <div className="mt-2 pt-2 border-t border-hairline space-y-3">
      <div>
        <p className="text-[10px] font-semibold text-accent mb-1">Checklist {checklist.length > 0 && `(${done}/${checklist.length})`}</p>
        <div className="space-y-1">
          {checklist.map(item => (
            <div key={item.id} className="flex items-center gap-2">
              <input type="checkbox" checked={item.done} onChange={e => { toggleChecklistItem(item.id, e.target.checked); reload(); }} className="accent-[var(--color-accent)]" />
              <span className={`text-xs flex-1 ${item.done ? 'line-through text-ink-faint' : 'text-ink'}`}>{item.label}</span>
              {canManage && <button onClick={() => { deleteChecklistItem(item.id); reload(); }} className="text-ink-faint hover:text-danger text-xs">✕</button>}
            </div>
          ))}
        </div>
        {canManage && (
          <div className="flex gap-1.5 mt-1.5">
            <Input placeholder="Add checklist item..." value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddItem()} className="flex-1 text-xs" />
            <Button size="sm" variant="secondary" onClick={handleAddItem}>Add</Button>
          </div>
        )}
      </div>

      <div>
        <p className="text-[10px] font-semibold text-accent mb-1">Comments</p>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {comments.map(c => (
            <div key={c.id} className="flex items-start gap-1.5">
              <ChatAvatar name={c.author?.name || 'Member'} avatar={c.author?.avatar} size={18} />
              <div className="min-w-0"><span className="text-[10px] font-semibold text-accent">{c.author?.name}</span> <span className="text-xs text-ink">{c.body}</span></div>
            </div>
          ))}
          {comments.length === 0 && <p className="text-[10px] text-ink-faint">No comments yet.</p>}
        </div>
        <div className="flex gap-1.5 mt-1.5">
          <Input placeholder="Add a comment..." value={commentBody} onChange={e => setCommentBody(e.target.value)} onKeyDown={e => e.key === 'Enter' && handlePostComment()} className="flex-1 text-xs" />
          <Button size="sm" variant="secondary" onClick={handlePostComment}>Post</Button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-accent">Time Tracked: {formatDuration(totalTrackedMs(timeEntries))}</p>
          <Button size="sm" variant={openEntry ? 'danger' : 'secondary'} onClick={handleToggleTimer}>{openEntry ? 'Stop Timer' : 'Start Timer'}</Button>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold text-accent mb-1">Depends On</p>
        <div className="space-y-1">
          {dependsOn.map(id => {
            const dep = allTasks.find(t => t.id === id);
            return (
              <div key={id} className="flex items-center justify-between text-xs">
                <span className={dep?.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'}>{dep?.title || 'Unknown task'}</span>
                {canManage && <button onClick={() => { removeDependency(task.id, id); reload(); }} className="text-ink-faint hover:text-danger">✕</button>}
              </div>
            );
          })}
          {dependsOn.length === 0 && <p className="text-[10px] text-ink-faint">No dependencies.</p>}
        </div>
        {canManage && (
          <div className="flex gap-1.5 mt-1.5">
            <select value={depPick} onChange={e => setDepPick(e.target.value)} className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-hairline bg-transparent text-ink">
              <option value="">Select a task...</option>
              {allTasks.filter(t => t.id !== task.id && !dependsOn.includes(t.id)).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <Button size="sm" variant="secondary" onClick={handleAddDependency}>Add</Button>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-accent mb-1">History</p>
          <div className="space-y-0.5">
            {history.map(h => (
              <p key={h.id} className="text-[10px] text-ink-faint">{new Date(h.created_at).toLocaleString()} · {h.event}{h.detail ? ` — ${h.detail}` : ''}</p>
            ))}
          </div>
        </div>
      )}
    </div>
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
    const ok = await confirmWithCaptcha(`Confirm: ${successTitle.replace(/ (sent|applied|requested)$/, '')} of $${amount}`);
    if (!ok) { swal({ icon: 'error', title: 'Verification failed', text: 'The answer was incorrect — action cancelled.' }); return; }
    setBusy(true);
    const error = await fn();
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Action failed', text: error }); return; }
    swalToast({ icon: 'success', title: successTitle });
    setAmount(''); setDetails('');
    refresh();
  };

  const handleWithdrawalDecision = async (id: string, approve: boolean) => {
    const ok = await confirmWithCaptcha(`Confirm: ${approve ? 'approve' : 'reject'} this withdrawal`);
    if (!ok) { swal({ icon: 'error', title: 'Verification failed', text: 'The answer was incorrect — action cancelled.' }); return; }
    const error = await decideWithdrawal(id, approve);
    if (error) { swal({ icon: 'error', title: 'Action failed', text: error }); return; }
    refresh();
  };

  if (loading) {
    return (
      <div className="grid lg:grid-cols-2 gap-4">
        <SkeletonCard className="h-64" />
        <SkeletonCard className="h-64" />
      </div>
    );
  }

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

      {loading && (canManageJoinRequests || canManageVacations) && (
        <>
          <SkeletonCard className="h-48" />
          <SkeletonCard className="h-48" />
        </>
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

  if (loading) {
    return (
      <div className="grid lg:grid-cols-2 gap-4">
        <SkeletonCard className="h-40" />
        <SkeletonCard className="h-52" />
        <SkeletonCard className="h-52" />
        <SkeletonCard className="h-52" />
      </div>
    );
  }

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
  const [seeding, setSeeding] = useState(false);
  const [commentsForFile, setCommentsForFile] = useState<CloudFile | null>(null);
  const [comments, setComments] = useState<CloudFileComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { session } = useTeamAuth();
  const myUserId = session?.user.id;

  const refresh = async () => {
    if (!team.telegram_channel_id) { setLoading(false); return; }
    setLoading(true);
    const { files: f, folders: fo } = await cc.fetchChannelFiles(team.telegram_channel_id);
    setFiles(f); setFolders(fo);
    setLoading(false);
    return fo;
  };

  useEffect(() => { refresh(); }, [team.telegram_channel_id]);

  // One-time seed of the fixed Tasks > Finished/Unfinished folder structure.
  useEffect(() => {
    if (!canManage || loading || seeding || !team.telegram_channel_id) return;
    const tasksRoot = folders.find(f => f.parentId === null && f.name === 'Tasks');
    if (!tasksRoot) {
      setSeeding(true);
      cc.createChannelFolder(team.telegram_channel_id, 'Tasks', null).then(() => refresh()).finally(() => setSeeding(false));
      return;
    }
    const hasFinished = folders.some(f => f.parentId === tasksRoot.id && f.name === 'Finished');
    const hasUnfinished = folders.some(f => f.parentId === tasksRoot.id && f.name === 'Unfinished');
    if (!hasFinished || !hasUnfinished) {
      setSeeding(true);
      (async () => {
        if (!hasFinished) await cc.createChannelFolder(team.telegram_channel_id, 'Finished', tasksRoot.id);
        if (!hasUnfinished) await cc.createChannelFolder(team.telegram_channel_id, 'Unfinished', tasksRoot.id);
        await refresh();
      })().finally(() => setSeeding(false));
    }
  }, [canManage, loading, folders, team.telegram_channel_id]);

  const currentFolder = folders.find(f => f.id === currentFolderId) || null;
  const isProtectedFolder = (name: string) => name === 'Tasks' || name === 'Finished' || name === 'Unfinished';
  const canUploadHere = canManage || !currentFolder || currentFolder.members.length === 0 || (!!myUserId && currentFolder.members.includes(myUserId));

  const handleCreateFolder = async (name: string, parentId: number | null) => {
    await cc.createChannelFolder(team.telegram_channel_id, name, parentId);
    refresh();
  };

  const handleDeleteFolder = async (folder: CloudFolder) => {
    if (isProtectedFolder(folder.name)) { swal({ icon: 'info', title: 'Protected folder', text: 'The Tasks/Finished/Unfinished structure cannot be deleted.' }); return; }
    const result = await swal({ icon: 'warning', title: `Delete folder "${folder.name}"?`, text: 'Files inside will remain, unfiled.', showCancelButton: true, confirmButtonText: 'Delete', confirmButtonColor: '#FF3B30' });
    if (!result.isConfirmed) return;
    await cc.deleteChannelFolder(team.telegram_channel_id, folder);
    refresh();
  };

  const handleEditFolderMembers = async (folder: CloudFolder, members: string[]) => {
    await cc.updateChannelFolderMembers(team.telegram_channel_id, folder, members);
    refresh();
  };

  const handleUpload = async (file: File) => {
    if (!canUploadHere) { swal({ icon: 'error', title: 'Not allowed', text: 'You are not a member of this folder.' }); return; }
    setUploading(true);
    await cc.uploadChannelFile(team.telegram_channel_id, file, currentFolderId);
    setUploading(false);
    swalToast({ icon: 'success', title: 'File uploaded' });
    refresh();
  };

  const handleDownload = async (file: CloudFile) => {
    await cc.downloadChannelFile(file);
  };

  const openComments = async (file: CloudFile) => {
    setCommentsForFile(file);
    setComments(await cc.listFileComments(team.telegram_channel_id, file.id));
  };

  const handlePostComment = async () => {
    if (!commentBody.trim() || !commentsForFile) return;
    await cc.postFileComment(team.telegram_channel_id, commentsForFile.id, commentBody.trim());
    setCommentBody('');
    setComments(await cc.listFileComments(team.telegram_channel_id, commentsForFile.id));
  };

  if (!team.telegram_channel_id) {
    return (
      <GlassCard className="p-8 text-center">
        <p className="text-sm text-ink-muted">No Telegram channel set for this team yet.</p>
        {canManage && <p className="text-xs text-ink-faint mt-1">Set one in the Roster section to enable shared Team Files.</p>}
      </GlassCard>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} className="aspect-square" />)}
      </div>
    );
  }

  const filesInFolder = files.filter(f => f.folderId === currentFolderId);
  const inFinished = currentFolder?.name === 'Finished';

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
          onEditMembers={canManage ? handleEditFolderMembers : undefined}
        />
      </div>

      {canUploadHere ? (
        <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <Upload size={13} /> {uploading ? 'Uploading...' : 'Upload File'}
        </Button>
      ) : (
        <p className="text-[11px] text-ink-faint">You're not a member of this folder — ask an admin to add you before uploading here.</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filesInFolder.length === 0 && (
          <p className="text-xs text-ink-faint text-center py-6 sm:col-span-2 lg:col-span-3">No files in this folder yet.</p>
        )}
        {filesInFolder.map(f => (
          <GlassCard key={f.id} className="p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink truncate">{f.name}</p>
                <p className="text-[10px] text-ink-faint">
                  {cc.formatSize(f.sizeBytes)} · {inFinished ? <span className="font-semibold text-accent">{f.sender}</span> : f.sender}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openComments(f)} aria-label={`Comments on ${f.name}`} className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors">
                  <MessageCircle size={14} />
                </button>
                <button onClick={() => handleDownload(f)} aria-label={`Download ${f.name}`} className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors">
                  <Download size={14} />
                </button>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      <Modal open={cc.isDownloading} onClose={() => {}} dismissible={false} title="Downloading" size="sm">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-ink truncate">{cc.downloadLabel}</p>
            <p className="text-xs text-ink-faint font-mono mt-0.5">{cc.formatSize(Math.round(cc.downloadTotalBytes * (cc.downloadProgress / 100)))} / {cc.formatSize(cc.downloadTotalBytes)}</p>
          </div>
          <div className="w-full bg-ink/10 border border-hairline h-3 rounded-full overflow-hidden relative">
            <div className="absolute top-0 left-0 bg-accent h-full transition-all duration-300" style={{ width: `${cc.downloadProgress}%` }} />
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white mix-blend-difference">{cc.downloadProgress}%</span>
          </div>
        </div>
      </Modal>

      {commentsForFile && (
        <Modal open onClose={() => setCommentsForFile(null)} title={`Comments — ${commentsForFile.name}`} size="sm">
          <div className="space-y-3">
            <div className="max-h-64 overflow-y-auto space-y-2">
              {comments.length === 0 && <p className="text-xs text-ink-faint text-center py-4">No comments yet.</p>}
              {comments.map(c => (
                <div key={c.id} className="p-2 rounded-lg bg-ink/[0.03]">
                  <p className="text-[10px] font-semibold text-accent">{c.author}</p>
                  <p className="text-xs text-ink whitespace-pre-line">{c.body}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input placeholder="Add a comment..." value={commentBody} onChange={e => setCommentBody(e.target.value)} onKeyDown={e => e.key === 'Enter' && handlePostComment()} className="flex-1" />
              <Button size="sm" onClick={handlePostComment}>Post</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat (team channel + DMs)
// ---------------------------------------------------------------------------

function ChatSection({ team, members, myMember, isOwner, canManage, onChanged, cc }: { team: Team; members: TeamMember[]; myMember: TeamMember | null; isOwner: boolean; canManage: boolean; onChanged: () => void; cc: CloudClient }) {
  const [mode, setMode] = useState<'team' | 'dm'>('team');
  const [activePartner, setActivePartner] = useState<string | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  const partnerMember = members.find(m => m.user_id === activePartner);
  const profileMember = members.find(m => m.user_id === profileUserId);

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

      {mode === 'team' && <TeamChatThread team={team} members={members} myMember={myMember} canManage={canManage} onOpenProfile={setProfileUserId} cc={cc} />}
      {mode === 'dm' && !activePartner && <ConversationList team={team} members={members} myMember={myMember} onSelect={setActivePartner} />}
      {mode === 'dm' && activePartner && (
        <DirectThread
          team={team}
          partnerId={activePartner}
          partnerName={partnerMember?.profile?.name || partnerMember?.invited_email || 'Member'}
          partnerAvatar={partnerMember?.profile?.avatar || ''}
          onBack={() => setActivePartner(null)}
          onOpenProfile={setProfileUserId}
          cc={cc}
        />
      )}

      {profileMember && (
        <MemberProfileModal
          team={team}
          member={profileMember}
          canManage={canManage}
          isOwner={isOwner}
          onClose={() => setProfileUserId(null)}
          onChanged={onChanged}
        />
      )}
    </GlassCard>
  );
}

function ChatAvatar({ name, avatar, size = 28 }: { name: string; avatar?: string; size?: number }) {
  return (
    <div
      className="rounded-full overflow-hidden bg-ink/5 border border-hairline shrink-0 flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-ink-faint font-semibold">{(name || '?')[0]?.toUpperCase()}</span>}
    </div>
  );
}

function hydrateSender(msg: TeamMessage, members: TeamMember[]): TeamMessage {
  if (msg.sender?.name) return msg;
  const m = members.find(mm => mm.user_id === msg.sender_id);
  return { ...msg, sender: { name: m?.profile?.name || m?.invited_email || 'Member', avatar: m?.profile?.avatar || '' } };
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex(x => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = [...list];
  next[idx] = item;
  return next;
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

function ReactionBar({ reactions, myUserId, onToggle }: { reactions: MessageReaction[]; myUserId: string | undefined; onToggle: (emoji: string) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const grouped = new Map<string, MessageReaction[]>();
  for (const r of reactions) {
    const list = grouped.get(r.emoji) ?? [];
    list.push(r);
    grouped.set(r.emoji, list);
  }
  return (
    <div className="flex items-center gap-1 flex-wrap mt-1">
      {Array.from(grouped.entries()).map(([emoji, list]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onToggle(emoji)}
          className={`text-[11px] px-1.5 py-0.5 rounded-full border transition-colors ${
            list.some(r => r.user_id === myUserId) ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted hover:border-accent/40'
          }`}
        >
          {emoji} {list.length}
        </button>
      ))}
      <div className="relative">
        <button type="button" onClick={() => setPickerOpen(o => !o)} className="text-[11px] px-1.5 py-0.5 rounded-full border border-hairline text-ink-faint hover:border-accent/40">+</button>
        {pickerOpen && (
          <div className="absolute z-10 top-full left-0 mt-1 flex gap-1 p-1.5 rounded-xl bg-surface border border-hairline shadow-lg">
            {QUICK_EMOJIS.map(e => (
              <button key={e} type="button" onClick={() => { onToggle(e); setPickerOpen(false); }} className="text-sm hover:scale-125 transition-transform">{e}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TeamChatThread({ team, members, myMember, canManage, onOpenProfile, cc }: {
  team: Team; members: TeamMember[]; myMember: TeamMember | null; canManage: boolean; onOpenProfile: (userId: string) => void; cc: CloudClient;
}) {
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<TeamMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typingLabel, setTypingLabel] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [showJumpToEnd, setShowJumpToEnd] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const typingRef = useRef<ReturnType<typeof subscribeToTyping> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { session } = useTeamAuth();
  const myUserId = session?.user.id;

  const reload = () => { listTeamMessages(team.id, search ? { search } : undefined).then(setMessages); };

  useEffect(() => {
    let mounted = true;
    reload();
    listReactions(team.id, 'team_messages').then(r => { if (mounted) setReactions(r); });
    const unsubMsgs = subscribeToTeamMessages(team.id, msg => setMessages(prev => upsertById(prev, hydrateSender(msg, members))));
    const unsubReactions = subscribeToReactions(team.id, () => listReactions(team.id, 'team_messages').then(setReactions));
    typingRef.current = subscribeToTyping(team.id, (userId, name) => {
      if (userId === myUserId) return;
      setTypingLabel(`${name} is typing`);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setTypingLabel(''), 3000);
    });
    return () => { mounted = false; unsubMsgs(); unsubReactions(); typingRef.current?.unsubscribe(); };
  }, [team.id, members, search]);

  useEffect(() => {
    if (nearBottomRef.current) bottomRef.current?.scrollIntoView({ block: 'end' });
    else setShowJumpToEnd(true);
  }, [messages.length]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    nearBottomRef.current = near;
    if (near) setShowJumpToEnd(false);
  };

  const jumpToEnd = () => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    nearBottomRef.current = true;
    setShowJumpToEnd(false);
  };

  useEffect(() => {
    if (messages.length > 0 && myUserId) markTeamChatRead(team.id, messages[messages.length - 1].id);
  }, [messages.length, team.id, myUserId]);

  const pinned = messages.filter(m => m.pinned && !m.deleted).slice(0, 3);
  const messageById = new Map(messages.map(m => [m.id, m]));

  const handleBodyChange = (v: string) => {
    setBody(v);
    const atMatch = v.match(/@([\w.-]*)$/);
    setMentionQuery(atMatch ? atMatch[1] : null);
    if (myMember?.profile?.name) typingRef.current?.notifyTyping(myUserId || '', myMember.profile.name);
  };

  const insertMention = (name: string) => {
    setBody(b => b.replace(/@([\w.-]*)$/, `@${name.replace(/\s+/g, '')} `));
    setMentionQuery(null);
  };

  const handleAttach = async (file: File) => {
    if (!team.telegram_channel_id || !cc.isConnected) {
      swal({ icon: 'info', title: 'Connect Telegram', text: 'Connect Telegram and set the team channel to send files in chat.' });
      return;
    }
    setAttaching(true);
    const result = await cc.uploadTaskAttachment(team.telegram_channel_id, file);
    setAttaching(false);
    if (result) {
      await sendTeamMessage(team.id, body.trim() || `📎 ${result.name}`, { attachment: result, replyToId: replyTo?.id });
      setBody(''); setReplyTo(null);
    }
  };

  const handleSend = async () => {
    if (!body.trim()) return;
    const text = body.trim();
    setBody(''); setMentionQuery(null);
    if (editingId) {
      await editTeamMessage(editingId, text);
      setEditingId(null);
      return;
    }
    await sendTeamMessage(team.id, text, { replyToId: replyTo?.id });
    setReplyTo(null);

    const mentioned = parseMentions(text, members);
    for (const userId of mentioned) {
      notify(userId, 'Mentioned you', `${myMember?.profile?.name || 'Someone'} mentioned you: "${text.slice(0, 80)}"`);
    }
    const others = members.filter(m => m.status === 'active' && m.user_id && m.user_id !== myUserId && !mentioned.includes(m.user_id!));
    for (const m of others) {
      if (m.notification_prefs?.chat !== false) notify(m.user_id!, `New message in ${team.name}`, text.slice(0, 80));
    }
  };

  const mentionCandidates = mentionQuery !== null
    ? members.filter(m => m.status === 'active' && (m.profile?.name || m.invited_email).toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5)
    : [];

  const reactionsFor = (id: string) => reactions.filter(r => r.message_id === id);

  return (
    <>
      {pinned.length > 0 && (
        <div className="px-3 py-2 border-b border-hairline bg-accent-soft/40 space-y-1 shrink-0">
          {pinned.map(p => (
            <p key={p.id} className="text-[11px] text-ink-muted truncate flex items-center gap-1">📌 <span className="font-semibold">{p.sender?.name}:</span> {p.body}</p>
          ))}
        </div>
      )}
      <div className="px-3 py-2 border-b border-hairline shrink-0">
        <Input placeholder="Search messages..." value={search} onChange={e => setSearch(e.target.value)} className="text-xs" />
      </div>
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-3 relative">
        {messages.length === 0 && <p className="text-xs text-ink-faint text-center py-6">No messages yet — say hello.</p>}
        {messages.map(m => {
          const replied = m.reply_to_id ? messageById.get(m.reply_to_id) : null;
          const isMine = m.sender_id === myUserId;
          return (
            <div key={m.id} className={`flex items-start gap-2 max-w-md group ${isMine ? 'ml-auto flex-row-reverse' : ''}`}>
              <button type="button" onClick={() => onOpenProfile(m.sender_id)} className="shrink-0">
                <ChatAvatar name={m.sender?.name || 'Member'} avatar={m.sender?.avatar} />
              </button>
              <div className="min-w-0 flex-1">
                <div className={`p-2.5 rounded-2xl min-w-0 backdrop-blur-sm shadow-sm transition-all duration-200 ${isMine ? 'bg-gradient-to-br from-accent-soft to-accent-soft/60 rounded-tr-sm' : 'bg-gradient-to-br from-ink/[0.04] to-ink/[0.02] rounded-tl-sm'}`}>
                  <div className={`flex items-center gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
                    <button type="button" onClick={() => onOpenProfile(m.sender_id)} className="text-[10px] font-semibold text-accent hover:underline">{m.sender?.name || 'Member'}</button>
                    {m.pinned && <span className="text-[9px] text-ink-faint">📌</span>}
                    {m.edited_at && !m.deleted && <span className="text-[9px] text-ink-faint">(edited)</span>}
                    <span className={`text-[9px] text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity flex gap-1.5 ${isMine ? 'mr-auto' : 'ml-auto'}`}>
                      {!m.deleted && <button onClick={() => setReplyTo(m)} className="hover:text-accent">Reply</button>}
                      {!m.deleted && isMine && <button onClick={() => { setEditingId(m.id); setBody(m.body); }} className="hover:text-accent">Edit</button>}
                      {!m.deleted && isMine && <button onClick={() => deleteTeamMessage(m.id)} className="hover:text-danger">Delete</button>}
                      {!m.deleted && canManage && <button onClick={() => pinTeamMessage(m.id, !m.pinned)} className="hover:text-accent">{m.pinned ? 'Unpin' : 'Pin'}</button>}
                    </span>
                  </div>
                  {replied && (
                    <div className="mt-1 mb-1 pl-2 border-l-2 border-accent/40 text-[10px] text-ink-faint truncate">
                      {replied.sender?.name}: {replied.deleted ? 'Message deleted' : replied.body}
                    </div>
                  )}
                  {m.deleted ? (
                    <p className="text-sm text-ink-faint italic">This message was deleted</p>
                  ) : (
                    <>
                      <p className="text-sm text-ink whitespace-pre-line">{m.body}</p>
                      {m.attachment_msg_id && (
                        <button
                          onClick={() => cc.downloadTaskAttachment(team.telegram_channel_id, m.attachment_msg_id!, m.attachment_name || 'attachment')}
                          className="text-[11px] text-accent hover:text-ink flex items-center gap-1 font-semibold mt-1"
                        >
                          <Paperclip size={11} /> {m.attachment_name || 'Attachment'}
                        </button>
                      )}
                    </>
                  )}
                </div>
                {!m.deleted && <ReactionBar reactions={reactionsFor(m.id)} myUserId={myUserId} onToggle={emoji => toggleReaction(team.id, 'team_messages', m.id, emoji)} />}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
        {showJumpToEnd && (
          <button
            onClick={jumpToEnd}
            className="absolute right-4 bottom-2 z-10 px-3 py-1.5 rounded-full bg-accent text-white text-[11px] font-semibold shadow-lg flex items-center gap-1 hover:brightness-110 transition-all"
          >
            <ChevronDown size={12} /> New messages
          </button>
        )}
      </div>
      {typingLabel && (
        <p className="px-3 text-[11px] text-ink-faint italic shrink-0 flex items-center gap-1">
          {typingLabel}
          <span className="inline-flex gap-0.5">
            <span className="animate-pulse [animation-delay:0ms]">›</span>
            <span className="animate-pulse [animation-delay:150ms]">›</span>
            <span className="animate-pulse [animation-delay:300ms]">›</span>
          </span>
        </p>
      )}
      {replyTo && (
        <div className="px-3 py-1.5 border-t border-hairline bg-ink/[0.02] flex items-center justify-between gap-2 shrink-0">
          <p className="text-[11px] text-ink-muted truncate">Replying to <span className="font-semibold">{replyTo.sender?.name}</span>: {replyTo.body}</p>
          <button onClick={() => setReplyTo(null)} className="text-ink-faint hover:text-danger text-xs shrink-0">✕</button>
        </div>
      )}
      <div className="p-3 border-t border-hairline shrink-0 relative">
        {mentionCandidates.length > 0 && (
          <div className="absolute bottom-full left-3 mb-1 flex flex-col rounded-xl bg-surface border border-hairline shadow-lg overflow-hidden">
            {mentionCandidates.map(m => (
              <button key={m.id} onClick={() => insertMention(m.profile?.name || m.invited_email)} className="px-3 py-1.5 text-xs text-left hover:bg-accent-soft">
                {m.profile?.name || m.invited_email}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleAttach(f); }} />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={attaching} className="p-2 rounded-xl text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors shrink-0">
            <Paperclip size={16} />
          </button>
          <Input placeholder={editingId ? 'Edit message...' : 'Message the team...'} value={body} onChange={e => handleBodyChange(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} className="flex-1" />
          <Button onClick={handleSend}><Send size={14} /></Button>
        </div>
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

  if (loading) {
    return (
      <div className="divide-y divide-hairline">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
      {conversations.map(c => (
        <button key={c.otherUserId} onClick={() => onSelect(c.otherUserId)} className="w-full flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-ink/5 transition-colors text-left">
          <ChatAvatar name={c.otherName} avatar={c.otherAvatar} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink truncate">{c.otherName}</p>
            <p className="text-xs text-ink-faint truncate">{c.lastMessage}</p>
          </div>
          {c.unread > 0 && <span className="text-[10px] font-bold text-white bg-accent rounded-full w-5 h-5 flex items-center justify-center shrink-0">{c.unread}</span>}
        </button>
      ))}
      {others.filter(m => !contacted.has(m.user_id!)).map(m => (
        <button key={m.id} onClick={() => onSelect(m.user_id!)} className="w-full flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-ink/5 transition-colors text-left">
          <ChatAvatar name={m.profile?.name || m.invited_email} avatar={m.profile?.avatar} />
          <p className="text-sm text-ink">{m.profile?.name || m.invited_email}</p>
        </button>
      ))}
      {conversations.length === 0 && others.length === 0 && <p className="text-xs text-ink-faint text-center py-6">No teammates to message yet.</p>}
    </div>
  );
}

function DirectThread({ team, partnerId, partnerName, partnerAvatar, onBack, onOpenProfile, cc }: {
  team: Team; partnerId: string; partnerName: string; partnerAvatar?: string; onBack: () => void; onOpenProfile: (userId: string) => void; cc: CloudClient;
}) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [showJumpToEnd, setShowJumpToEnd] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { session } = useTeamAuth();
  const myUserId = session?.user.id;

  useEffect(() => {
    let mounted = true;
    listDirectMessages(team.id, partnerId).then(msgs => { if (mounted) setMessages(msgs); });
    listReactions(team.id, 'direct_messages').then(r => { if (mounted) setReactions(r); });
    markDirectMessagesRead(team.id, partnerId);
    const unsubscribe = subscribeToDirectMessages(team.id, msg => {
      if (msg.sender_id === partnerId || msg.receiver_id === partnerId) setMessages(prev => upsertById(prev, msg));
    });
    const unsubReactions = subscribeToReactions(team.id, () => listReactions(team.id, 'direct_messages').then(setReactions));
    return () => { mounted = false; unsubscribe(); unsubReactions(); };
  }, [team.id, partnerId]);

  useEffect(() => {
    if (nearBottomRef.current) bottomRef.current?.scrollIntoView({ block: 'end' });
    else setShowJumpToEnd(true);
  }, [messages.length]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    nearBottomRef.current = near;
    if (near) setShowJumpToEnd(false);
  };

  const jumpToEnd = () => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    nearBottomRef.current = true;
    setShowJumpToEnd(false);
  };

  const messageById = new Map(messages.map(m => [m.id, m]));
  const reactionsFor = (id: string) => reactions.filter(r => r.message_id === id);

  const handleAttach = async (file: File) => {
    if (!team.telegram_channel_id || !cc.isConnected) {
      swal({ icon: 'info', title: 'Connect Telegram', text: 'Connect Telegram and set the team channel to send files in chat.' });
      return;
    }
    setAttaching(true);
    const result = await cc.uploadTaskAttachment(team.telegram_channel_id, file);
    setAttaching(false);
    if (result) {
      await sendDirectMessage(team.id, partnerId, body.trim() || `📎 ${result.name}`, { attachment: result, replyToId: replyTo?.id });
      setBody(''); setReplyTo(null);
    }
  };

  const handleSend = async () => {
    if (!body.trim()) return;
    const text = body.trim();
    setBody('');
    if (editingId) {
      await editDirectMessage(editingId, text);
      setEditingId(null);
      return;
    }
    await sendDirectMessage(team.id, partnerId, text, { replyToId: replyTo?.id });
    setReplyTo(null);
    notify(partnerId, `New message from ${session?.user.email || 'a teammate'}`, text.slice(0, 80));
  };

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline shrink-0">
        <button onClick={onBack} aria-label="Back" className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors">
          <ArrowLeft size={14} />
        </button>
        <button type="button" onClick={() => onOpenProfile(partnerId)} className="flex items-center gap-2 hover:opacity-80">
          <ChatAvatar name={partnerName} avatar={partnerAvatar} size={24} />
          <p className="text-sm font-semibold text-ink">{partnerName}</p>
        </button>
      </div>
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-3 relative">
        {messages.map(m => {
          const replied = m.reply_to_id ? messageById.get(m.reply_to_id) : null;
          const isMine = m.sender_id !== partnerId;
          return (
            <div key={m.id} className={`flex items-end gap-2 max-w-md group ${isMine ? 'ml-auto flex-row-reverse' : ''}`}>
              <ChatAvatar name={partnerName} avatar={m.sender_id === partnerId ? partnerAvatar : undefined} size={22} />
              <div className="min-w-0">
                <div className={`p-2.5 rounded-2xl min-w-0 backdrop-blur-sm shadow-sm transition-all duration-200 ${m.sender_id === partnerId ? 'bg-gradient-to-br from-ink/[0.04] to-ink/[0.02] rounded-bl-sm' : 'bg-gradient-to-br from-accent-soft to-accent-soft/60 rounded-br-sm'}`}>
                  {(m.edited_at || isMine) && !m.deleted && (
                    <div className="flex items-center gap-1.5 justify-end mb-0.5">
                      {m.edited_at && <span className="text-[9px] text-ink-faint">(edited)</span>}
                      <span className="text-[9px] text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity flex gap-1.5">
                        <button onClick={() => setReplyTo(m)} className="hover:text-accent">Reply</button>
                        {isMine && <button onClick={() => { setEditingId(m.id); setBody(m.body); }} className="hover:text-accent">Edit</button>}
                        {isMine && <button onClick={() => deleteDirectMessage(m.id)} className="hover:text-danger">Delete</button>}
                      </span>
                    </div>
                  )}
                  {replied && (
                    <div className="mb-1 pl-2 border-l-2 border-accent/40 text-[10px] text-ink-faint truncate">
                      {replied.deleted ? 'Message deleted' : replied.body}
                    </div>
                  )}
                  {m.deleted ? (
                    <p className="text-sm text-ink-faint italic">This message was deleted</p>
                  ) : (
                    <>
                      <p className="text-sm text-ink whitespace-pre-line">{m.body}</p>
                      {m.attachment_msg_id && (
                        <button
                          onClick={() => cc.downloadTaskAttachment(team.telegram_channel_id, m.attachment_msg_id!, m.attachment_name || 'attachment')}
                          className="text-[11px] text-accent hover:text-ink flex items-center gap-1 font-semibold mt-1"
                        >
                          <Paperclip size={11} /> {m.attachment_name || 'Attachment'}
                        </button>
                      )}
                    </>
                  )}
                </div>
                {!m.deleted && <ReactionBar reactions={reactionsFor(m.id)} myUserId={myUserId} onToggle={emoji => toggleReaction(team.id, 'direct_messages', m.id, emoji)} />}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
        {showJumpToEnd && (
          <button
            onClick={jumpToEnd}
            className="absolute right-4 bottom-2 z-10 px-3 py-1.5 rounded-full bg-accent text-white text-[11px] font-semibold shadow-lg flex items-center gap-1 hover:brightness-110 transition-all"
          >
            <ChevronDown size={12} /> New messages
          </button>
        )}
      </div>
      {replyTo && (
        <div className="px-3 py-1.5 border-t border-hairline bg-ink/[0.02] flex items-center justify-between gap-2 shrink-0">
          <p className="text-[11px] text-ink-muted truncate">Replying to: {replyTo.body}</p>
          <button onClick={() => setReplyTo(null)} className="text-ink-faint hover:text-danger text-xs shrink-0">✕</button>
        </div>
      )}
      <div className="p-3 border-t border-hairline flex gap-2 shrink-0">
        <input ref={fileInputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleAttach(f); }} />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={attaching} className="p-2 rounded-xl text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors shrink-0">
          <Paperclip size={16} />
        </button>
        <Input placeholder={editingId ? 'Edit message...' : 'Type a message...'} value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} className="flex-1" />
        <Button onClick={handleSend}><Send size={14} /></Button>
      </div>
    </>
  );
}

function MemberProfileModal({ team, member, canManage, isOwner, onClose, onChanged }: {
  team: Team; member: TeamMember; canManage: boolean; isOwner: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [badges, setBadges] = useState<MemberBadge[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (member.user_id) listMemberBadges(team.id, member.user_id).then(setBadges); }, [team.id, member.user_id]);

  const withBusy = (fn: () => Promise<string | null>) => async () => {
    setBusy(true);
    const error = await fn();
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Action failed', text: error }); return; }
    onChanged();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Member Profile" size="sm">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <ChatAvatar name={member.profile?.name || member.invited_email} avatar={member.profile?.avatar} size={52} />
          <div className="min-w-0">
            <p className="text-base font-semibold text-ink truncate flex items-center gap-1.5">
              {member.profile?.name || member.invited_email}
              {member.role === 'leader' && <Crown size={13} className="text-accent shrink-0" />}
            </p>
            <p className="text-xs text-ink-faint">{member.job_title || 'No job title'}{member.priority != null ? ` · P${member.priority}` : ''}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-ink-faint text-xs">Streak</p><p className="font-bold text-ink flex items-center gap-1"><Flame size={13} className="text-accent" /> {member.streak_count} days</p></div>
          <div><p className="text-ink-faint text-xs">Balance</p><p className="font-bold text-ink">${member.balance.toFixed(2)}</p></div>
          <div><p className="text-ink-faint text-xs">Status</p><p className="font-semibold text-ink">{member.member_status.replace('_', ' ')}</p></div>
          <div><p className="text-ink-faint text-xs">Available</p><p className="font-semibold text-ink">{member.is_active ? 'Yes' : 'No'}</p></div>
        </div>

        {badges.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-accent font-semibold">Badges</p>
            <div className="flex flex-wrap gap-1.5">
              {badges.map(b => (
                <span key={b.code} className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-accent-soft text-accent flex items-center gap-1"><Trophy size={11} /> {b.label}</span>
              ))}
            </div>
          </div>
        )}

        {canManage && isOwner && (
          <div className="flex gap-2 pt-2 border-t border-hairline">
            {member.role === 'leader' ? (
              <Button size="sm" variant="secondary" onClick={withBusy(() => demoteToMember(member.id))} disabled={busy}><ArrowDownCircle size={13} /> Demote</Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={withBusy(() => promoteToLeader(member.id))} disabled={busy}><ArrowUpCircle size={13} /> Promote</Button>
            )}
            <Button size="sm" variant="danger" onClick={withBusy(() => removeMember(member.id))} disabled={busy}><UserMinus size={13} /> Remove</Button>
          </div>
        )}
      </div>
    </Modal>
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
