import { useState, useRef, useEffect } from 'react';
import { MessageSquare, RefreshCw, User, File, Download, Paperclip, Send, X, Users } from 'lucide-react';
import { GlassCard } from '../ui';
import type { CloudClient, CloudChatMessage } from '../../lib/cloudClient';
import type { Profile } from '../../types';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function dayLabel(timestamp: number): string {
  const d = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function CloudChat({ cc, profile }: { cc: CloudClient; profile: Profile }) {
  const [chatMessage, setChatMessage] = useState('');
  const [chatFile, setChatFile] = useState<File | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ordered = [...cc.chatMessages].reverse();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [ordered.length]);

  const handleSend = async () => {
    if (!chatMessage.trim() && !chatFile) return;
    await cc.sendChatMessage(chatMessage, chatFile, profile);
    setChatMessage('');
    setChatFile(null);
  };

  return (
    <div className="flex flex-col h-[70vh] max-h-[600px] min-h-[400px]">
      <GlassCard className="flex flex-col flex-1 min-h-0 overflow-hidden p-0">
        {/* WhatsApp-style conversation header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-hairline bg-ink/[0.02]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-accent-soft border border-accent/30 flex items-center justify-center shrink-0">
              <Users className="text-accent" size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-ink truncate">Team Discussion</h3>
              <p className="text-[11px] text-ink-faint">Central Channel</p>
            </div>
          </div>
          <button onClick={cc.fetchChatMessages} className="text-accent hover:text-ink flex items-center gap-1 bg-accent-soft px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto w-full px-3 sm:px-5 py-4 flex flex-col bg-ink/[0.015]">
          {ordered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-ink-faint opacity-50">
              <MessageSquare size={48} className="mb-2" />
              <p>No messages yet. Start the discussion with your team!</p>
            </div>
          ) : (
            ordered.map((msg: CloudChatMessage, idx) => {
              const prev = ordered[idx - 1];
              const isNewDay = !prev || dayLabel(prev.timestamp) !== dayLabel(msg.timestamp);
              const isMe = msg.sender === profile.name && profile.name !== '';
              const sameSenderAsPrev = prev && prev.sender === msg.sender && (msg.timestamp - prev.timestamp) < GROUP_WINDOW_MS && !isNewDay;
              const showHeader = !sameSenderAsPrev;

              return (
                <div key={msg.id}>
                  {isNewDay && (
                    <div className="flex justify-center my-3">
                      <span className="text-[10px] font-semibold text-ink-faint bg-ink/5 border border-hairline px-3 py-1 rounded-full">{dayLabel(msg.timestamp)}</span>
                    </div>
                  )}
                  <div className={`flex items-end gap-2 max-w-[85%] sm:max-w-[70%] ${isMe ? 'self-end flex-row-reverse ml-auto' : 'self-start'} ${showHeader ? 'mt-3' : 'mt-0.5'}`}>
                    <div className={`w-7 h-7 rounded-full overflow-hidden bg-accent-soft border border-accent/30 shrink-0 flex items-center justify-center ${showHeader ? '' : 'invisible'}`}>
                      {msg.avatar ? <img src={msg.avatar} alt={msg.sender} className="w-full h-full object-cover" /> : <User size={13} className="text-accent" />}
                    </div>
                    <div className="flex flex-col min-w-0">
                      {!isMe && showHeader && <span className="text-[10px] text-accent font-bold mb-0.5 ml-1">{msg.sender}</span>}
                      <div className={`relative px-3 py-2 rounded-2xl ${isMe ? 'bg-accent text-white rounded-br-md' : 'bg-elevated border border-hairline text-ink rounded-bl-md'} shadow-sm`}>
                        {msg.text && <p className="text-sm whitespace-pre-wrap break-words pr-10">{msg.text}</p>}
                        {msg.hasMedia && (
                          <div className={`${msg.text ? 'mt-2' : ''} p-2 rounded-lg bg-black/15 flex items-center gap-2 border border-white/10 pr-10`}>
                            <File size={18} className="shrink-0" />
                            <span className="text-xs truncate max-w-[140px]">{msg.fileName || 'Attachment'}</span>
                            <button
                              onClick={() => cc.downloadAttachment(msg.msgObj, msg.fileName || 'attachment')}
                              className="ml-auto bg-white/20 hover:bg-white/30 p-1 rounded shrink-0"
                            >
                              <Download size={13} />
                            </button>
                          </div>
                        )}
                        <span className={`absolute bottom-1 right-2.5 text-[9px] font-mono ${isMe ? 'text-white/70' : 'text-ink-faint'}`}>{timeLabel(msg.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {chatFile && (
          <div className="flex items-center gap-2 mx-3 sm:mx-5 mb-2 bg-accent-soft p-2 rounded-xl border border-accent/30">
            <File size={16} className="text-accent" />
            <span className="text-xs text-ink flex-1 truncate">{chatFile.name}</span>
            <button onClick={() => setChatFile(null)} className="text-danger hover:opacity-80 p-1"><X size={14} /></button>
          </div>
        )}

        {/* WhatsApp-style pill input bar */}
        <div className="flex items-center gap-2 px-3 sm:px-5 py-3 border-t border-hairline bg-ink/[0.02]">
          <input
            type="file"
            id="chat-file-upload"
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) setChatFile(e.target.files[0]); }}
          />
          <label
            htmlFor="chat-file-upload"
            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full bg-ink/5 hover:bg-ink/10 border border-hairline text-ink-muted cursor-pointer transition-colors"
          >
            <Paperclip size={17} />
          </label>

          <input
            type="text"
            value={chatMessage}
            onChange={e => setChatMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Message your team..."
            className="flex-1 min-w-0 bg-ink/5 border border-hairline rounded-full px-4 py-2.5 text-sm text-ink outline-none focus:border-accent transition-colors"
          />

          <button
            onClick={handleSend}
            disabled={!chatMessage.trim() && !chatFile}
            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full bg-accent text-white disabled:opacity-40 hover:opacity-90 transition-all active:scale-95"
            aria-label="Send"
          >
            <Send size={16} />
          </button>
        </div>
      </GlassCard>
    </div>
  );
}
