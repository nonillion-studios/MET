import { useEffect, useState } from 'react';
import { Megaphone, Trash2 } from 'lucide-react';
import { GlassCard, Button, Textarea, Switch } from './ui';
import { swal, swalToast } from '../lib/swalTheme';
import { listAllAdminMessages, upsertAdminMessage, deleteAdminMessage, type AdminMessage } from '../lib/adminMessages';

export function AdminAnnouncementsPanel() {
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = () => { listAllAdminMessages().then(m => { setMessages(m); setLoading(false); }); };
  useEffect(() => { reload(); }, []);

  const handlePost = async () => {
    if (!body.trim()) { swal({ icon: 'error', title: 'Write a message first' }); return; }
    setSaving(true);
    const error = await upsertAdminMessage({ body: body.trim(), active });
    setSaving(false);
    if (error) { swal({ icon: 'error', title: 'Could not post message', text: error }); return; }
    setBody('');
    swalToast({ icon: 'success', title: 'Announcement posted' });
    reload();
  };

  const handleToggle = async (m: AdminMessage) => {
    setBusyId(m.id);
    const error = await upsertAdminMessage({ id: m.id, body: m.body, active: !m.active, startsAt: m.starts_at, endsAt: m.ends_at });
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not update message', text: error }); return; }
    reload();
  };

  const handleDelete = async (id: string) => {
    const result = await swal({ icon: 'warning', title: 'Delete this announcement?', showCancelButton: true, confirmButtonText: 'Delete', confirmButtonColor: '#FF3B30' });
    if (!result.isConfirmed) return;
    setBusyId(id);
    const error = await deleteAdminMessage(id);
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not delete', text: error }); return; }
    reload();
  };

  return (
    <GlassCard className="p-6 space-y-4">
      <h3 className="text-base font-semibold text-ink font-display flex items-center gap-2">
        <Megaphone size={16} className="text-success" /> Announcements
      </h3>
      <p className="text-xs text-ink-faint -mt-2">Posted here appears as a banner above the Library tab for every signed-in user.</p>

      <div className="space-y-2">
        <Textarea placeholder="Write an announcement..." value={body} onChange={e => setBody(e.target.value)} rows={2} />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-ink">
            <Switch checked={active} onChange={setActive} /> Active
          </div>
          <Button size="sm" onClick={handlePost} disabled={saving}>{saving ? 'Posting...' : 'Post'}</Button>
        </div>
      </div>

      {!loading && messages.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-hairline">
          {messages.map(m => (
            <div key={m.id} className="flex items-start justify-between gap-2 p-2.5 rounded-xl bg-ink/5 border border-hairline">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-ink whitespace-pre-line">{m.body}</p>
                <p className="text-[10px] text-ink-faint mt-0.5">{new Date(m.created_at).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Switch checked={m.active} onChange={() => handleToggle(m)} disabled={busyId === m.id} />
                <button onClick={() => handleDelete(m.id)} disabled={busyId === m.id} aria-label="Delete" className="p-1.5 rounded-lg text-ink-faint hover:text-danger hover:bg-danger/10 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
