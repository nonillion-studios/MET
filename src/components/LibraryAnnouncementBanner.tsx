import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { listActiveAdminMessages, type AdminMessage } from '../lib/adminMessages';

const DISMISSED_KEY = 'library_announcement_dismissed';

function getDismissed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function dismiss(id: string) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...getDismissed(), id].slice(-50)));
}

export function LibraryAnnouncementBanner() {
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>(getDismissed());

  useEffect(() => {
    listActiveAdminMessages().then(setMessages);
  }, []);

  const visible = messages.filter(m => !dismissedIds.includes(m.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {visible.map(m => (
        <div
          key={m.id}
          className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-success"
        >
          <Megaphone size={15} className="mt-0.5 shrink-0" />
          <p className="flex-1 text-xs font-medium leading-snug whitespace-pre-line">{m.body}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => { dismiss(m.id); setDismissedIds(prev => [...prev, m.id]); }}
            className="shrink-0 rounded-full p-0.5 hover:bg-success/20 transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
