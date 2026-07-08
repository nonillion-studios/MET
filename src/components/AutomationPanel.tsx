import { useState } from 'react';
import { Plus, Trash2, Play, Pencil, Zap, Clock, Bell, Cloud as CloudIcon, AlarmClock, BellRing } from 'lucide-react';
import type { Automation, AutomationAction, AutomationTrigger, Workspace } from '../types';
import { Modal, Button, Input, Textarea, GlassCard, Switch } from './ui';
import { AdSlot } from './AdSlot';
import { swal } from '../lib/swalTheme';
import { requestNotificationPermission } from '../lib/automationEngine';

interface AutomationPanelProps {
  automations: Automation[];
  workspaces: Workspace[];
  createAutomation: (input: { name: string; description: string; trigger: AutomationTrigger; action: AutomationAction }) => void;
  updateAutomation: (id: string, updates: { name: string; description: string; trigger: AutomationTrigger; action: AutomationAction }) => void;
  deleteAutomation: (id: string) => void;
  toggleAutomation: (id: string) => void;
  runNow: (id: string) => void;
}

const INTERVAL_PRESETS = [
  { label: 'Hourly', ms: 60 * 60 * 1000 },
  { label: 'Daily', ms: 24 * 60 * 60 * 1000 },
  { label: 'Weekly', ms: 7 * 24 * 60 * 60 * 1000 },
];

const ACTION_TYPES: { type: AutomationAction['type']; label: string; icon: typeof Bell }[] = [
  { type: 'reminder', label: 'Reminder', icon: Bell },
  { type: 'staleChapterCheck', label: 'Stale Chapter Check', icon: AlarmClock },
  { type: 'cloudBackup', label: 'Cloud Backup', icon: CloudIcon },
];

function describeTrigger(trigger: AutomationTrigger): string {
  if (trigger.type === 'onOpen') return 'Every app open';
  const preset = INTERVAL_PRESETS.find(p => p.ms === trigger.everyMs);
  return preset ? preset.label : `Every ${Math.round(trigger.everyMs / 60000)}m`;
}

function describeAction(action: AutomationAction, workspaces: Workspace[]): string {
  switch (action.type) {
    case 'reminder': return action.message ? `Remind: ${action.message}` : 'Reminder';
    case 'staleChapterCheck': return `Stale check (${action.days}d)`;
    case 'cloudBackup': {
      const ws = workspaces.find(w => w.id === action.workspaceId);
      return `Back up "${ws ? ws.name : 'deleted workspace'}"`;
    }
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface FormState {
  name: string;
  description: string;
  triggerType: 'interval' | 'onOpen';
  everyMs: number;
  actionType: AutomationAction['type'];
  reminderMessage: string;
  staleDays: number;
  workspaceId: string;
}

function defaultForm(workspaces: Workspace[]): FormState {
  return {
    name: '',
    description: '',
    triggerType: 'interval',
    everyMs: INTERVAL_PRESETS[1].ms,
    actionType: 'reminder',
    reminderMessage: '',
    staleDays: 14,
    workspaceId: workspaces[0]?.id || '',
  };
}

export function AutomationPanel({ automations, workspaces, createAutomation, updateAutomation, deleteAutomation, toggleAutomation, runNow }: AutomationPanelProps) {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => defaultForm(workspaces));
  const [notifPermission, setNotifPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported' as const);

  const openCreate = () => {
    setEditingId(null);
    setForm(defaultForm(workspaces));
    setShowModal(true);
  };

  const openEdit = (a: Automation) => {
    setEditingId(a.id);
    setForm({
      name: a.name,
      description: a.description,
      triggerType: a.trigger.type,
      everyMs: a.trigger.type === 'interval' ? a.trigger.everyMs : INTERVAL_PRESETS[1].ms,
      actionType: a.action.type,
      reminderMessage: a.action.type === 'reminder' ? a.action.message : '',
      staleDays: a.action.type === 'staleChapterCheck' ? a.action.days : 14,
      workspaceId: a.action.type === 'cloudBackup' ? a.action.workspaceId : (workspaces[0]?.id || ''),
    });
    setShowModal(true);
  };

  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    if (result === 'unsupported') {
      swal({ icon: 'info', title: 'Not Supported', text: "This browser doesn't support notifications — automations will still show in-app toasts." });
      return;
    }
    setNotifPermission(result as NotificationPermission);
    if (result === 'granted') swal({ icon: 'success', title: 'Notifications Enabled', text: 'Automations can now show real browser notifications.' });
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      swal({ icon: 'error', title: 'Name Required', text: 'Please give this automation a name.' });
      return;
    }
    if (form.actionType === 'cloudBackup' && !form.workspaceId) {
      swal({ icon: 'error', title: 'Workspace Required', text: 'Create a workspace first, then pick it here.' });
      return;
    }
    const trigger: AutomationTrigger = form.triggerType === 'onOpen'
      ? { type: 'onOpen' }
      : { type: 'interval', everyMs: form.everyMs };
    const action: AutomationAction =
      form.actionType === 'reminder' ? { type: 'reminder', message: form.reminderMessage.trim() || 'Take a look at your library.' } :
      form.actionType === 'staleChapterCheck' ? { type: 'staleChapterCheck', days: form.staleDays } :
      { type: 'cloudBackup', workspaceId: form.workspaceId };

    const payload = { name: form.name.trim(), description: form.description.trim(), trigger, action };
    if (editingId) updateAutomation(editingId, payload);
    else createAutomation(payload);
    setShowModal(false);
  };

  const handleDelete = async (a: Automation) => {
    const result = await swal({
      icon: 'warning',
      title: 'Delete this automation?',
      text: `"${a.name}" will stop running.`,
      showCancelButton: true,
      confirmButtonText: 'Delete',
      confirmButtonColor: '#FF3B30',
    });
    if (result.isConfirmed) deleteAutomation(a.id);
  };

  return (
    <div className="space-y-5">
      <AdSlot placement="scheduler-top" />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-display font-semibold text-ink flex items-center gap-2">
            <Zap className="text-accent" size={20} /> Automation
          </h2>
          <p className="text-xs text-ink-muted mt-0.5">Local rules that run while this tab is open — reminders, checks, and real cloud backups.</p>
        </div>
        <div className="flex items-center gap-2">
          {notifPermission !== 'granted' && (
            <Button variant="secondary" size="sm" onClick={handleEnableNotifications}>
              <BellRing size={14} /> Enable Notifications
            </Button>
          )}
          <Button size="sm" onClick={openCreate}><Plus size={14} /> New Automation</Button>
        </div>
      </div>

      {automations.length === 0 ? (
        <GlassCard className="p-10 flex flex-col items-center text-center gap-3">
          <Clock className="text-ink-faint" size={30} />
          <p className="text-sm text-ink-muted max-w-sm">No automations yet. Create one to get reminders and recurring checks while you work.</p>
          <Button onClick={openCreate}><Plus size={14} /> Create Automation</Button>
        </GlassCard>
      ) : (
        <GlassCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Trigger</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Last Run</th>
                  <th className="px-4 py-3 font-semibold">Next Run</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {automations.map(a => (
                  <tr key={a.id} className="border-b border-hairline last:border-0 hover:bg-ink/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{a.name}</p>
                      {a.description && <p className="text-[11px] text-ink-faint truncate max-w-[220px]">{a.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-ink-muted whitespace-nowrap">{describeTrigger(a.trigger)}</td>
                    <td className="px-4 py-3 text-ink-muted whitespace-nowrap">{describeAction(a.action, workspaces)}</td>
                    <td className="px-4 py-3">
                      <Switch checked={a.enabled} onChange={() => toggleAutomation(a.id)} aria-label={`Toggle ${a.name}`} />
                    </td>
                    <td className="px-4 py-3 text-ink-faint font-mono text-[11px] whitespace-nowrap">{formatDate(a.lastRunAt)}</td>
                    <td className="px-4 py-3 text-ink-faint font-mono text-[11px] whitespace-nowrap">{a.enabled ? formatDate(a.nextRunAt) : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => runNow(a.id)} className="p-1.5 rounded-lg text-ink-muted hover:text-accent hover:bg-accent-soft transition-colors" aria-label={`Run ${a.name} now`}>
                          <Play size={14} />
                        </button>
                        <button onClick={() => openEdit(a)} className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-ink/8 transition-colors" aria-label={`Edit ${a.name}`}>
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDelete(a)} className="p-1.5 rounded-lg text-ink-muted hover:text-danger hover:bg-danger/10 transition-colors" aria-label={`Delete ${a.name}`}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editingId ? 'Edit Automation' : 'New Automation'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave}><Zap size={14} /> {editingId ? 'Save Changes' : 'Create Automation'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input placeholder="Automation name" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
          <Textarea placeholder="Short description (optional)" value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} className="h-16" />

          <div className="space-y-2">
            <label className="text-xs text-accent font-semibold">Trigger</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setForm(f => ({ ...f, triggerType: 'interval' }))}
                className={`py-2 rounded-xl border text-xs font-medium transition-colors ${form.triggerType === 'interval' ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`}
              >
                On a schedule
              </button>
              <button
                onClick={() => setForm(f => ({ ...f, triggerType: 'onOpen' }))}
                className={`py-2 rounded-xl border text-xs font-medium transition-colors ${form.triggerType === 'onOpen' ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`}
              >
                Every app open
              </button>
            </div>
            {form.triggerType === 'interval' && (
              <div className="grid grid-cols-3 gap-2">
                {INTERVAL_PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => setForm(f => ({ ...f, everyMs: p.ms }))}
                    className={`py-2 rounded-xl border text-xs font-medium transition-colors ${form.everyMs === p.ms ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs text-accent font-semibold">Action</label>
            <div className="grid grid-cols-3 gap-2">
              {ACTION_TYPES.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  onClick={() => setForm(f => ({ ...f, actionType: type }))}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-[11px] font-medium transition-colors ${form.actionType === type ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
            {form.actionType === 'reminder' && (
              <Input placeholder="Message to show" value={form.reminderMessage} onChange={(e) => setForm(f => ({ ...f, reminderMessage: e.target.value }))} />
            )}
            {form.actionType === 'staleChapterCheck' && (
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={1}
                  value={form.staleDays}
                  onChange={(e) => setForm(f => ({ ...f, staleDays: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                  className="w-24"
                />
                <span className="text-xs text-ink-muted">days of inactivity</span>
              </div>
            )}
            {form.actionType === 'cloudBackup' && (
              workspaces.length === 0 ? (
                <p className="text-xs text-ink-faint">Create a workspace in Library first to back it up.</p>
              ) : (
                <select
                  value={form.workspaceId}
                  onChange={(e) => setForm(f => ({ ...f, workspaceId: e.target.value }))}
                  className="w-full bg-ink/5 border border-hairline rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-accent"
                >
                  {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              )
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
