import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { listActiveAdminMessages, type AdminMessage } from '../lib/adminMessages';

export function LibraryAnnouncementBanner() {
  const [messages, setMessages] = useState<AdminMessage[]>([]);

  useEffect(() => {
    listActiveAdminMessages().then(setMessages);
  }, []);

  if (messages.length === 0) return null;

  return (
    <div className="space-y-2">
      {messages.map(m => (
        <div
          key={m.id}
          className="liquid-glass flex items-start gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-accent"
        >
          <Megaphone size={15} className="mt-0.5 shrink-0" />
          <p className="flex-1 text-xs font-medium leading-snug whitespace-pre-line">{m.body}</p>
        </div>
      ))}
    </div>
  );
}
