import { useRef, useState } from 'react';
import { X, Plus, Trash2, Download, Upload, Play } from 'lucide-react';
import type { PersistedPlaylistMeta } from './musicPlayerStore';
import type { Track } from './MusicPlayer';

interface ExportedTrack {
  title: string;
  artist?: string;
  fileName: string;
}

interface PlaylistManagerProps {
  playlists: PersistedPlaylistMeta[];
  activePlaylistId: string;
  tracksByPlaylist: Record<string, Track[]>;
  onSelectPlaylist: (id: string) => void;
  onCreatePlaylist: (name: string) => void;
  onDeletePlaylist: (id: string) => void;
  onMoveTrack: (trackId: string, fromPlaylistId: string, toPlaylistId: string) => void;
  onImportTracks: (playlistId: string, imported: ExportedTrack[]) => void;
  onClose: () => void;
}

/**
 * Dedicated multi-playlist view: every playlist as its own column, tracks draggable between them
 * (native HTML5 DnD — `dataTransfer` carries the track id + source playlist id since there's no
 * other way to know which column a drop came from). Import/Export JSON is metadata-only (title/
 * artist/filename) — a track's actual audio is a `URL.createObjectURL()` reference that cannot
 * survive being serialized to JSON, so an imported track restores as a visible-but-unplayable
 * placeholder (`objectUrl: null`) rather than pretending to bring the audio back with it.
 */
export function PlaylistManager({
  playlists, activePlaylistId, tracksByPlaylist, onSelectPlaylist, onCreatePlaylist,
  onDeletePlaylist, onMoveTrack, onImportTracks, onClose,
}: PlaylistManagerProps) {
  const [newName, setNewName] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  function handleExport(playlistId: string) {
    // Spotify tracks have no local file to back up/restore this way (a Spotify link is trivially
    // re-added by pasting it again) — export local tracks only, matching this backup's existing
    // metadata-only scope.
    const tracks = (tracksByPlaylist[playlistId] ?? []).filter((t): t is Track & { fileName: string } => t.kind === 'local' && !!t.fileName);
    const payload: ExportedTrack[] = tracks.map((t) => ({ title: t.title, artist: t.artist, fileName: t.fileName }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${playlists.find((p) => p.id === playlistId)?.name ?? 'playlist'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(playlistId: string, file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter(
        (item): item is ExportedTrack => typeof item === 'object' && item !== null && typeof (item as ExportedTrack).title === 'string',
      );
      onImportTracks(playlistId, valid);
    } catch {
      // Malformed JSON -- nothing to import, silently no-op rather than a confusing partial import.
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div
        className="liquid-glass-heavy rounded-2xl border border-hairline shadow-2xl w-[min(90vw,720px)] max-h-[80vh] flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
          <span className="text-ui font-medium text-ink">Manage Playlists</span>
          <button type="button" aria-label="Close" onClick={onClose} className="studio-interactive studio-focusable text-ink-faint">
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-hairline">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New playlist name"
            className="flex-1 bg-ink/5 border border-hairline rounded-control px-2 py-1 text-micro text-ink"
          />
          <button
            type="button"
            onClick={() => { if (newName.trim()) { onCreatePlaylist(newName.trim()); setNewName(''); } }}
            className="studio-interactive studio-focusable flex items-center gap-1 text-micro px-2 py-1 rounded-control border border-hairline text-ink"
          >
            <Plus size={13} /> New Playlist
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-x-auto flex gap-3 p-3">
          {playlists.map((pl) => {
            const tracks = tracksByPlaylist[pl.id] ?? [];
            const isActive = pl.id === activePlaylistId;
            return (
              <div
                key={pl.id}
                className={`w-56 shrink-0 flex flex-col rounded-lg border ${isActive ? 'border-accent' : 'border-hairline'}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const data = e.dataTransfer.getData('text/plain');
                  const [trackId, fromPlaylistId] = data.split('::');
                  if (trackId && fromPlaylistId) onMoveTrack(trackId, fromPlaylistId, pl.id);
                }}
              >
                <div className="flex items-center justify-between px-2 py-1.5 border-b border-hairline">
                  <button
                    type="button"
                    onClick={() => onSelectPlaylist(pl.id)}
                    className="flex items-center gap-1 min-w-0 text-micro font-medium text-ink truncate"
                    title="Set as active playlist"
                  >
                    {isActive && <Play size={10} className="shrink-0 text-accent" />}
                    <span className="truncate">{pl.name}</span>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" aria-label="Export playlist" title="Export JSON" onClick={() => handleExport(pl.id)}
                      className="studio-interactive studio-focusable text-ink-faint"><Download size={12} /></button>
                    <button
                      type="button"
                      aria-label="Import into playlist"
                      title="Import JSON"
                      onClick={() => {
                        importInputRef.current?.setAttribute('data-target', pl.id);
                        importInputRef.current?.click();
                      }}
                      className="studio-interactive studio-focusable text-ink-faint"
                    >
                      <Upload size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete playlist"
                      title="Delete playlist"
                      disabled={playlists.length <= 1}
                      onClick={() => onDeletePlaylist(pl.id)}
                      className="studio-interactive studio-focusable text-ink-faint disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-[4rem] max-h-56 overflow-y-auto p-1 flex flex-col gap-0.5">
                  {tracks.length === 0 && <div className="text-micro text-ink-faint text-center py-3">Empty</div>}
                  {tracks.map((t) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', `${t.id}::${pl.id}`)}
                      className={`px-1.5 py-1 rounded text-micro truncate cursor-grab ${t.kind === 'spotify' || t.objectUrl ? 'text-ink' : 'italic text-ink-faint'}`}
                      title={t.title}
                    >
                      {t.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            const targetId = importInputRef.current?.getAttribute('data-target');
            if (file && targetId) void handleImportFile(targetId, file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
