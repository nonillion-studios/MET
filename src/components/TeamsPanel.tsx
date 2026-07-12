import { useEffect, useRef, useState } from 'react';
import { Users, ImagePlus, Plus, Mail, Check, X, Crown, ShieldCheck, ArrowUpCircle, ArrowDownCircle, UserMinus, Send, ListTodo, Paperclip, CalendarClock, Trash2 } from 'lucide-react';
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
import {
  Task, createTask, listTeamTasks, listMyTasks, markTaskDone, deleteTask, attachFileToTask, setTeamTelegramChannel,
} from '../lib/tasks';
import type { CloudClient } from '../lib/cloudClient';

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
                  <p className="text-[10px] text-ink-faint truncate">{m.invited_email}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.status === 'active' ? 'bg-accent-soft text-accent' : 'bg-ink/5 text-ink-faint'}`}>
                  {m.status === 'active' ? 'Active' : 'Pending'}
                </span>
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

  return (
    <div className="space-y-5">
      <TeamRoster team={team} members={members} isOwner canManageMembers onChanged={refresh} />
      <TasksSection team={team} members={members} canManageTasks cc={cc} />
    </div>
  );
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
    return (
      <div className="space-y-5">
        <TeamRoster
          team={membership.team}
          members={members}
          isOwner={false}
          canManageMembers={membership.role === 'leader'}
          onChanged={refresh}
        />
        <TasksSection team={membership.team} members={members} canManageTasks={membership.role === 'leader'} cc={cc} />
      </div>
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

function formatDue(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

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
    if (result) await attachFileToTask(task.id, result);
    setBusy(false);
    if (result) { swalToast({ icon: 'success', title: 'File attached' }); onChanged(); }
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
        title={cc.isConnected ? 'Attach a file' : 'Connect Telegram in Cloud Storage first'}
      >
        <Paperclip size={11} /> {busy ? 'Uploading...' : 'Attach file'}
      </button>
    </>
  );
}

function TasksSection({ team, members, canManageTasks, cc }: { team: Team; members: TeamMember[]; canManageTasks: boolean; cc: CloudClient }) {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setTasks(canManageTasks ? await listTeamTasks(team.id) : await listMyTasks(team.id));
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [team.id, canManageTasks]);

  const activeMembers = members.filter(m => m.status === 'active');

  const handleCreate = async () => {
    if (!title.trim() || !assigneeId) {
      swal({ icon: 'error', title: 'Missing details', text: 'Give the task a title and pick an assignee.' });
      return;
    }
    setCreating(true);
    const error = await createTask({ teamId: team.id, assigneeId, title: title.trim(), description: description.trim(), dueDate: dueDate || null });
    setCreating(false);
    if (error) { swal({ icon: 'error', title: 'Could not create task', text: error }); return; }
    setTitle(''); setDescription(''); setAssigneeId(''); setDueDate('');
    swalToast({ icon: 'success', title: 'Task created' });
    refresh();
  };

  const handleMarkDone = async (id: string) => {
    setBusyId(id);
    const error = await markTaskDone(id);
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not update task', text: error }); return; }
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
          <h3 className="text-base font-semibold text-ink font-display">{canManageTasks ? 'Tasks' : 'My Tasks'}</h3>
          <p className="text-xs text-ink-muted mt-0.5">{canManageTasks ? 'Assign and track work across the team' : 'Tasks assigned to you'}</p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {canManageTasks && (
          <div className="space-y-2 pb-4 border-b border-hairline">
            <Input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full bg-ink/5 border border-hairline rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-accent"
              >
                <option value="">Assign to...</option>
                {activeMembers.map(m => <option key={m.id} value={m.user_id ?? ''}>{m.profile?.name || m.invited_email}</option>)}
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
          {tasks.map(t => (
            <div key={t.id} className={`p-3 rounded-xl border transition-colors ${t.status === 'done' ? 'border-hairline bg-ink/[0.02]' : 'border-hairline hover:border-accent/20'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`text-sm font-semibold truncate ${t.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'}`}>{t.title}</p>
                  {t.description && <p className="text-xs text-ink-muted mt-0.5">{t.description}</p>}
                  {canManageTasks && <p className="text-[10px] text-ink-faint mt-1">{t.assignee?.name || 'Unassigned'}</p>}
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
                  <TaskAttachmentControl task={t} team={team} cc={cc} onChanged={refresh} />
                </div>
                {t.status === 'done' ? (
                  <span className="text-[10px] font-semibold text-success flex items-center gap-1"><Check size={11} /> Done</span>
                ) : (
                  !canManageTasks && (
                    <Button size="sm" onClick={() => handleMarkDone(t.id)} disabled={busyId === t.id}>Mark Done</Button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}
