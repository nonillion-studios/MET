import { useEffect, useState } from 'react';
import { Cloud } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { CloudConfig } from './cloud/CloudConfig';
import { CloudFiles } from './cloud/CloudFiles';
import { CloudChat } from './cloud/CloudChat';
import type { CloudClient } from '../lib/cloudClient';
import type { Profile, Workspace } from '../types';

interface CloudStorageProps {
  cc: CloudClient;
  workspaces: Workspace[];
  profile: Profile;
  onImportWorkspace: (workspace: Workspace) => void;
}

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function CloudStorage({ cc, workspaces, profile, onImportWorkspace }: CloudStorageProps) {
  const [activeTab, setActiveTab] = useState<'config' | 'files' | 'chat'>('config');

  useEffect(() => {
    if (cc.isConnected) setActiveTab('files');
  }, [cc.isConnected]);

  useEffect(() => {
    if (cc.isConnected && cc.chatId) {
      if (activeTab === 'files') cc.fetchFiles();
      if (activeTab === 'chat') cc.fetchChatMessages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cc.isConnected, cc.chatId, activeTab]);

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-4 sm:p-8 relative overflow-y-auto w-full min-h-screen">
      <div className="absolute top-0 right-0 w-64 h-64 sm:w-[500px] sm:h-[500px] bg-accent/10 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-64 h-64 sm:w-[500px] sm:h-[500px] bg-accent/10 rounded-full blur-[150px] pointer-events-none" />

      <div className="max-w-6xl mx-auto w-full flex flex-col gap-8 relative z-10 animate-fade-in pb-20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-hairline pb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-ink flex items-center gap-3">
              <Cloud className="text-accent" size={32} />
              Central Cloud Storage
            </h1>
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2">
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${cc.isConnected ? 'bg-success/10 text-success border border-success/30' : 'bg-ink/5 text-ink-muted border border-hairline'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cc.isConnected ? 'bg-success animate-pulse' : 'bg-ink-faint'}`} />
                {cc.isConnected ? 'Connected via Telegram' : 'Not connected'}
              </span>
              {cc.isConnected && (
                <span className="text-xs text-ink-faint font-mono">
                  {cc.files.length} file{cc.files.length === 1 ? '' : 's'} · {cc.lastSyncedAt ? `synced ${timeAgo(cc.lastSyncedAt)}` : 'not synced yet'}
                </span>
              )}
            </div>
          </div>
          {cc.isConnected && (
            <div className="flex items-center gap-1 bg-ink/5 border border-hairline rounded-full p-1 shrink-0">
              {([
                { id: 'files', label: 'Files' },
                { id: 'chat', label: 'Discussions' },
                { id: 'config', label: 'Settings' },
              ] as const).map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${activeTab === t.id ? 'bg-accent text-white shadow-md shadow-accent/25' : 'text-ink-muted hover:text-ink'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'config' && <CloudConfig key="config" cc={cc} />}
          {activeTab === 'files' && cc.isConnected && (
            <CloudFiles key="files" cc={cc} workspaces={workspaces} profile={profile} onImportWorkspace={onImportWorkspace} />
          )}
          {activeTab === 'chat' && cc.isConnected && <CloudChat key="chat" cc={cc} profile={profile} />}
        </AnimatePresence>
      </div>
    </div>
  );
}
