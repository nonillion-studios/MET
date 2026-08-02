import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Music2, X, ChevronUp, ChevronDown, Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, Volume2, VolumeX, Upload, ListMusic, Trash2, Link,
} from 'lucide-react';

/** Lucide has no Spotify brand glyph — a minimal inline approximation of the recognizable three-arc
 *  mark, just enough to visually distinguish a Spotify row from a local/other one at a glance. */
function SpotifyGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="12" cy="12" r="11" fill="#1DB954" />
      <path d="M6.5 9.5c3.2-1 7.3-.7 10 .9" stroke="#0a0a0a" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M7 13c2.6-.8 5.9-.6 8.2.8" stroke="#0a0a0a" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M7.5 16.2c2-.6 4.5-.4 6.3.7" stroke="#0a0a0a" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
import { useMusicPlayerVisibility } from './MusicPlayerContext';
import {
  loadMusicPlayerState, saveMusicPlayerState, DEFAULT_PLAYLIST_ID,
  type MusicPlayerPersistedState, type RepeatMode, type PersistedPlaylistMeta,
} from './musicPlayerStore';
import { PlaylistManager } from './PlaylistManager';

/** A local track's real audio data lives only as a `URL.createObjectURL()` reference — session
 *  memory only, never persisted (see musicPlayerStore.ts's doc comment). `objectUrl: null` marks a
 *  track restored from an imported JSON playlist backup whose underlying file isn't available on
 *  this device — shown, but not playable, rather than silently dropped.
 *
 *  A Spotify track carries no audio data at all — Spotify's embed iframe owns its own playback
 *  entirely, this app never touches its audio stream (Spotify doesn't allow direct extraction).
 *  `kind` already existed as a real discriminant before Spotify was added (reserved for a future
 *  YouTube variant too), so widening it here is additive, not a reshape. */
export interface Track {
  id: string;
  kind: 'local' | 'spotify';
  title: string;
  artist?: string;
  duration?: number;
  // local-only
  fileName?: string;
  objectUrl?: string | null;
  // spotify-only
  spotifyId?: string;
  spotifyType?: 'track' | 'playlist' | 'album';
}

const ACCEPTED_TYPES = '.mp3,.mp4,.wav,.ogg,.flac,.m4a,.aac,audio/*';

/** Parses a standard open.spotify.com URL (optionally with query params/a locale path segment
 *  Spotify sometimes includes, e.g. /intl-en/) into its embeddable type + id. Returns null for
 *  anything else so the caller can show a clear "not a Spotify link" response instead of silently
 *  adding a broken track. */
export function parseSpotifyUrl(url: string): { type: 'track' | 'playlist' | 'album'; id: string } | null {
  const match = url.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|playlist|album)\/([A-Za-z0-9]+)/);
  if (!match) return null;
  return { type: match[1] as 'track' | 'playlist' | 'album', id: match[2] };
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fileNameToTitle(name: string): string {
  return name.replace(/\.[^/.]+$/, '');
}

/**
 * Floating, draggable music player — local file playback (Web Audio frequency-bar visualization),
 * multi-playlist management, shuffle/repeat, all state persisted (settings + playlist names only,
 * never track data — see musicPlayerStore.ts). Rendered as a `createPortal` to `document.body` so
 * it floats above Studio *and* the Text Editor equally, mounted once at the app root
 * (`App.tsx`) and toggled via `MusicPlayerContext` from either surface's own toolbar button.
 *
 * YouTube playback is a deferred follow-up (see CLAUDE.md) — the `Track` shape already reserves
 * `kind` for it so adding it later is additive, not a reshape, but no YouTube UI exists yet; this
 * session ships local-file playback only, per an explicit scope decision (a full YouTube iframe
 * integration is a separate large feature, and this app is otherwise deliberately offline-first).
 */
export function MusicPlayer() {
  const { hidden, toggle } = useMusicPlayerVisibility();
  const [persisted, setPersisted] = useState<MusicPlayerPersistedState>(() => loadMusicPlayerState());
  const [tracksByPlaylist, setTracksByPlaylist] = useState<Record<string, Track[]>>({ [DEFAULT_PLAYLIST_ID]: [] });
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [managerOpen, setManagerOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const [reorderIndex, setReorderIndex] = useState<number | null>(null);
  const [spotifyUrlInput, setSpotifyUrlInput] = useState('');
  const [spotifyUrlError, setSpotifyUrlError] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const warnedAboutMissingRef = useRef(false);

  const activePlaylistId = persisted.activePlaylistId ?? persisted.playlists[0]?.id ?? DEFAULT_PLAYLIST_ID;
  const tracks = tracksByPlaylist[activePlaylistId] ?? [];
  const currentIndex = tracks.findIndex((t) => t.id === currentTrackId);
  const currentTrack = currentIndex >= 0 ? tracks[currentIndex] : null;

  // Persist settings (never track data) on every change.
  useEffect(() => { saveMusicPlayerState(persisted); }, [persisted]);
  useEffect(() => { setPersisted((p) => ({ ...p, hidden })); }, [hidden]);

  useEffect(() => {
    if (!warnedAboutMissingRef.current && persisted.playlists.length > 0 && tracks.length === 0) {
      warnedAboutMissingRef.current = true;
    }
  }, [persisted.playlists.length, tracks.length]);

  const patchPersisted = useCallback((patch: Partial<MusicPlayerPersistedState>) => {
    setPersisted((p) => ({ ...p, ...patch }));
  }, []);

  // --- Audio element wiring --------------------------------------------------
  useEffect(() => {
    const audio = new Audio();
    audio.volume = persisted.volume;
    audio.muted = persisted.muted;
    audioRef.current = audio;
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => handleTrackEnded();
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.pause();
      audioCtxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = persisted.volume;
    audio.muted = persisted.muted;
  }, [persisted.volume, persisted.muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!currentTrack?.objectUrl) {
      audio.pause();
      audio.removeAttribute('src');
      setIsPlaying(false);
      return;
    }
    if (audio.src !== currentTrack.objectUrl) {
      audio.src = currentTrack.objectUrl;
      setCurrentTime(0);
    }
    if (isPlaying) audio.play().catch(() => setIsPlaying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentTrack?.objectUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack?.objectUrl) return;
    if (isPlaying) audio.play().catch(() => setIsPlaying(false));
    else audio.pause();
  }, [isPlaying, currentTrack?.objectUrl]);

  function ensureAnalyser(): AnalyserNode | null {
    const audio = audioRef.current;
    if (!audio) return null;
    if (analyserRef.current) return analyserRef.current;
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      sourceNodeRef.current = source;
      analyserRef.current = analyser;
      return analyser;
    } catch {
      return null;
    }
  }

  // --- Waveform / frequency-bar visualization --------------------------------
  useEffect(() => {
    if (hidden || persisted.minimized) return;
    const analyser = ensureAnalyser();
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const data = new Uint8Array(analyser.frequencyBinCount);

    function draw() {
      if (!ctx || !canvas) return;
      analyser!.getByteFrequencyData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = canvas.width / data.length;
      for (let i = 0; i < data.length; i++) {
        const h = (data[i] / 255) * canvas.height;
        ctx.fillStyle = 'rgba(124, 106, 245, 0.85)';
        ctx.fillRect(i * barWidth, canvas.height - h, Math.max(1, barWidth - 1), h);
      }
      rafRef.current = requestAnimationFrame(draw);
    }
    draw();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, persisted.minimized, currentTrack?.id]);

  // --- Track / playlist management -------------------------------------------
  function addTracksToPlaylist(playlistId: string, newTracks: Track[]) {
    setTracksByPlaylist((prev) => ({ ...prev, [playlistId]: [...(prev[playlistId] ?? []), ...newTracks] }));
  }

  function handleUploadFiles(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files); // FileList is live -- snapshot before the input is ever cleared.
    const newTracks: Track[] = list.map((file) => ({
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: 'local',
      title: fileNameToTitle(file.name),
      fileName: file.name,
      objectUrl: URL.createObjectURL(file),
    }));
    addTracksToPlaylist(activePlaylistId, newTracks);
    if (!currentTrackId && newTracks.length > 0) setCurrentTrackId(newTracks[0].id);
  }

  function handleAddSpotifyUrl() {
    const parsed = parseSpotifyUrl(spotifyUrlInput.trim());
    if (!parsed) { setSpotifyUrlError(true); return; }
    const track: Track = {
      id: `spotify-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: 'spotify',
      title: `Spotify ${parsed.type}`,
      spotifyId: parsed.id,
      spotifyType: parsed.type,
    };
    addTracksToPlaylist(activePlaylistId, [track]);
    if (!currentTrackId) playTrack(track.id);
    setSpotifyUrlInput('');
    setSpotifyUrlError(false);
  }

  function playTrack(id: string) {
    setCurrentTrackId(id);
    setIsPlaying(true);
  }

  function handlePlayPause() {
    if (!currentTrack) {
      if (tracks.length > 0) playTrack(tracks[0].id);
      return;
    }
    setIsPlaying((p) => !p);
  }

  function pickNextIndex(direction: 1 | -1): number | null {
    if (tracks.length === 0) return null;
    if (persisted.shuffle) {
      if (tracks.length === 1) return 0;
      let next = Math.floor(Math.random() * tracks.length);
      while (next === currentIndex) next = Math.floor(Math.random() * tracks.length);
      return next;
    }
    const base = currentIndex < 0 ? (direction === 1 ? -1 : 0) : currentIndex;
    const next = base + direction;
    if (next < 0) return persisted.repeat === 'all' ? tracks.length - 1 : null;
    if (next >= tracks.length) return persisted.repeat === 'all' ? 0 : null;
    return next;
  }

  function handleNext() {
    const next = pickNextIndex(1);
    if (next != null) playTrack(tracks[next].id);
    else setIsPlaying(false);
  }

  function handlePrev() {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
    const prev = pickNextIndex(-1);
    if (prev != null) playTrack(tracks[prev].id);
  }

  function handleTrackEnded() {
    if (persisted.repeat === 'one') {
      const audio = audioRef.current;
      if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
      return;
    }
    handleNext();
  }

  function handleDeleteTrack(id: string) {
    setTracksByPlaylist((prev) => {
      const list = prev[activePlaylistId] ?? [];
      const track = list.find((t) => t.id === id);
      if (track?.objectUrl) URL.revokeObjectURL(track.objectUrl);
      return { ...prev, [activePlaylistId]: list.filter((t) => t.id !== id) };
    });
    if (id === currentTrackId) { setCurrentTrackId(null); setIsPlaying(false); }
  }

  function handleClearAll() {
    const list = tracksByPlaylist[activePlaylistId] ?? [];
    list.forEach((t) => { if (t.objectUrl) URL.revokeObjectURL(t.objectUrl); });
    setTracksByPlaylist((prev) => ({ ...prev, [activePlaylistId]: [] }));
    if (tracks.some((t) => t.id === currentTrackId)) { setCurrentTrackId(null); setIsPlaying(false); }
  }

  function reorderTrack(from: number, to: number) {
    setTracksByPlaylist((prev) => {
      const list = [...(prev[activePlaylistId] ?? [])];
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      return { ...prev, [activePlaylistId]: list };
    });
  }

  function cycleRepeat() {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    patchPersisted({ repeat: order[(order.indexOf(persisted.repeat) + 1) % order.length] });
  }

  // --- Drag (header) -----------------------------------------------------------
  function onHeaderPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = { startX: e.clientX, startY: e.clientY, originX: persisted.position.x, originY: persisted.position.y };
    setDragOffset({ dx: 0, dy: 0 });
    const onMove = (ev: PointerEvent) => {
      const d = dragStateRef.current;
      if (!d) return;
      setDragOffset({ dx: ev.clientX - d.startX, dy: ev.clientY - d.startY });
    };
    const onUp = (ev: PointerEvent) => {
      const d = dragStateRef.current;
      if (d) {
        const width = 320, height = 40;
        const nextX = Math.max(0, Math.min(window.innerWidth - width, d.originX + (ev.clientX - d.startX)));
        const nextY = Math.max(0, Math.min(window.innerHeight - height, d.originY + (ev.clientY - d.startY)));
        patchPersisted({ position: { x: nextX, y: nextY } });
      }
      dragStateRef.current = null;
      setDragOffset(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // --- Keyboard shortcuts (only when player focused / canvas+editor not focused) --
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (hidden) return;
      const target = e.target as HTMLElement | null;
      const inEditable = target?.closest('input, textarea, [contenteditable="true"], .te-page');
      if (inEditable) return;
      if (e.key === ' ') { e.preventDefault(); handlePlayPause(); }
      else if (e.key === 'ArrowRight') handleNext();
      else if (e.key === 'ArrowLeft') handlePrev();
      else if (e.key.toLowerCase() === 'm') patchPersisted({ muted: !persisted.muted });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, currentTrack, tracks, persisted.shuffle, persisted.repeat, persisted.muted, isPlaying]);

  const playlists: PersistedPlaylistMeta[] = persisted.playlists;
  const duration = currentTrack?.duration ?? audioRef.current?.duration ?? 0;

  const seekTo = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = fraction * audio.duration;
    setCurrentTime(audio.currentTime);
  }, []);

  const displayPos = dragOffset
    ? { x: persisted.position.x + dragOffset.dx, y: persisted.position.y + dragOffset.dy }
    : persisted.position;

  const title = currentTrack?.title ?? 'No track playing';

  const body = hidden ? null : (
    <div
      className="fixed z-[1000] w-80 liquid-glass-heavy rounded-2xl border border-hairline shadow-2xl overflow-hidden select-none"
      style={{ left: displayPos.x, top: displayPos.y }}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        className="flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing border-b border-hairline bg-ink/5"
      >
        <Music2 size={14} className="shrink-0 text-accent" />
        <span className="flex-1 min-w-0 truncate text-ui font-medium text-ink">{title}</span>
        <button
          type="button"
          aria-label={persisted.minimized ? 'Expand player' : 'Minimize player'}
          onClick={() => patchPersisted({ minimized: !persisted.minimized })}
          className="studio-interactive studio-focusable text-ink-faint shrink-0"
        >
          {persisted.minimized ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button
          type="button"
          aria-label="Hide player"
          onClick={toggle}
          className="studio-interactive studio-focusable text-ink-faint shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {!persisted.minimized && (
        <div className="p-3 flex flex-col gap-3">
          <div className="flex gap-3">
            {/* Cover art: local files get a generic placeholder (real embedded-artwork extraction
                is out of scope this pass); Spotify tracks show their own art via the embed below,
                so no placeholder is drawn here for them. */}
            {currentTrack?.kind !== 'spotify' && (
              <div className="w-20 h-20 shrink-0 rounded-lg border border-hairline bg-ink/5 flex items-center justify-center text-ink-faint">
                <Music2 size={28} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-ui font-medium text-ink truncate">{title}</div>
              {currentTrack?.artist && <div className="text-micro text-ink-faint truncate">{currentTrack.artist}</div>}
              {currentTrack?.kind === 'local' && !currentTrack.objectUrl && (
                <div className="text-micro text-red-400">File unavailable — re-upload to play</div>
              )}
              {currentTrack?.kind === 'spotify' && (
                <div className="text-micro text-ink-faint">Spotify tracks advance manually</div>
              )}
            </div>
          </div>

          {currentTrack?.kind === 'spotify' && currentTrack.spotifyId && currentTrack.spotifyType ? (
            // The embed owns its own transport/volume/artwork entirely — this app's own seek bar,
            // play/pause, and volume slider only ever drive the <audio> element, which has nothing
            // loaded while a Spotify track is current (see the objectUrl-gated effects above), so
            // none of that chrome would do anything meaningful here.
            <iframe
              key={currentTrack.id}
              src={`https://open.spotify.com/embed/${currentTrack.spotifyType}/${currentTrack.spotifyId}`}
              width="100%"
              height="152"
              style={{ border: 0, borderRadius: 12 }}
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              title={`Spotify ${currentTrack.spotifyType} embed`}
            />
          ) : (
            <>
              <canvas ref={canvasRef} width={296} height={48} className="w-full h-12 rounded-md bg-ink/5" />

              <div className="flex flex-col gap-1">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={duration > 0 ? currentTime / duration : 0}
                  onChange={(e) => seekTo(Number(e.target.value))}
                  className="w-full accent-[var(--color-accent)]"
                />
                <div className="flex justify-between text-micro text-ink-faint tabular-nums">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-3">
                <button type="button" aria-label="Shuffle" onClick={() => patchPersisted({ shuffle: !persisted.shuffle })}
                  className={`studio-interactive studio-focusable ${persisted.shuffle ? 'text-accent' : 'text-ink-faint'}`}>
                  <Shuffle size={15} />
                </button>
                <button type="button" aria-label="Previous" onClick={handlePrev} className="studio-interactive studio-focusable text-ink">
                  <SkipBack size={17} />
                </button>
                <button
                  type="button"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  onClick={handlePlayPause}
                  className="studio-interactive studio-focusable w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center"
                >
                  {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
                </button>
                <button type="button" aria-label="Next" onClick={handleNext} className="studio-interactive studio-focusable text-ink">
                  <SkipForward size={17} />
                </button>
                <button type="button" aria-label={`Repeat: ${persisted.repeat}`} onClick={cycleRepeat}
                  className={`studio-interactive studio-focusable ${persisted.repeat !== 'off' ? 'text-accent' : 'text-ink-faint'}`}>
                  {persisted.repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={persisted.muted ? 'Unmute' : 'Mute'}
                  onClick={() => patchPersisted({ muted: !persisted.muted })}
                  className="studio-interactive studio-focusable text-ink-faint shrink-0"
                >
                  {persisted.muted || persisted.volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                <input
                  type="range" min={0} max={1} step={0.01} value={persisted.volume}
                  onChange={(e) => patchPersisted({ volume: Number(e.target.value), muted: false })}
                  className="flex-1 accent-[var(--color-accent)]"
                />
              </div>
            </>
          )}

          <div className="border-t border-hairline pt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-micro uppercase tracking-wide text-ink-faint">Playlist</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleClearAll} className="text-micro text-ink-faint hover:text-red-400">Clear All</button>
                <button type="button" onClick={() => setManagerOpen(true)} aria-label="Manage Playlists" title="Manage Playlists"
                  className="studio-interactive studio-focusable text-ink-faint">
                  <ListMusic size={14} />
                </button>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
              {tracks.length === 0 && (
                <div className="text-micro text-ink-faint py-2 text-center">No tracks yet</div>
              )}
              {tracks.map((t, i) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(i)); setReorderIndex(i); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = reorderIndex ?? Number(e.dataTransfer.getData('text/plain'));
                    if (!Number.isNaN(from)) reorderTrack(from, i);
                    setReorderIndex(null);
                  }}
                  onClick={() => playTrack(t.id)}
                  className={`flex items-center gap-2 px-1.5 py-1 rounded-md cursor-pointer text-micro ${t.id === currentTrackId ? 'bg-accent/15 text-accent' : 'text-ink hover:bg-ink/5'}`}
                >
                  <span className="w-4 text-right tabular-nums text-ink-faint">{i + 1}</span>
                  {t.kind === 'spotify' && (
                    <span title="Spotify" className="shrink-0">
                      <SpotifyGlyph size={11} />
                    </span>
                  )}
                  <span className={`flex-1 min-w-0 truncate ${t.kind === 'local' && !t.objectUrl ? 'italic opacity-60' : ''}`}>{t.title}</span>
                  <span className="tabular-nums text-ink-faint">{t.duration ? formatTime(t.duration) : ''}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${t.title}`}
                    onClick={(e) => { e.stopPropagation(); handleDeleteTrack(t.id); }}
                    className="studio-interactive studio-focusable text-ink-faint hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              <input
                value={spotifyUrlInput}
                onChange={(e) => { setSpotifyUrlInput(e.target.value); setSpotifyUrlError(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddSpotifyUrl(); }}
                placeholder="Paste a Spotify track/playlist/album link…"
                aria-label="Spotify URL"
                className={`flex-1 min-w-0 bg-ink/5 border rounded-control px-2 py-1.5 text-micro text-ink ${spotifyUrlError ? 'border-red-400' : 'border-hairline'}`}
              />
              <button
                type="button"
                aria-label="Add Spotify link"
                title="Add Spotify link"
                onClick={handleAddSpotifyUrl}
                disabled={!spotifyUrlInput.trim()}
                className="studio-interactive studio-focusable shrink-0 w-8 h-8 flex items-center justify-center rounded-md border border-hairline text-ink disabled:opacity-40 disabled:pointer-events-none"
              >
                <Link size={13} />
              </button>
            </div>
            {spotifyUrlError && <div className="text-micro text-red-400 mt-1">Not a valid Spotify track/playlist/album link.</div>}
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-1.5 text-micro py-1.5 rounded-md border border-hairline hover:bg-ink/5 text-ink"
              >
                <Upload size={12} /> Upload File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                multiple
                className="hidden"
                onChange={(e) => { handleUploadFiles(e.target.files); e.target.value = ''; }}
              />
            </div>
          </div>
        </div>
      )}

      {managerOpen && (
        <PlaylistManager
          playlists={playlists}
          activePlaylistId={activePlaylistId}
          tracksByPlaylist={tracksByPlaylist}
          onSelectPlaylist={(id) => patchPersisted({ activePlaylistId: id })}
          onCreatePlaylist={(name) => {
            const id = `pl-${Date.now()}`;
            patchPersisted({ playlists: [...playlists, { id, name }], activePlaylistId: id });
            setTracksByPlaylist((prev) => ({ ...prev, [id]: [] }));
          }}
          onDeletePlaylist={(id) => {
            if (playlists.length <= 1) return;
            const remaining = playlists.filter((p) => p.id !== id);
            (tracksByPlaylist[id] ?? []).forEach((t) => { if (t.objectUrl) URL.revokeObjectURL(t.objectUrl); });
            setTracksByPlaylist((prev) => { const next = { ...prev }; delete next[id]; return next; });
            patchPersisted({ playlists: remaining, activePlaylistId: activePlaylistId === id ? remaining[0].id : activePlaylistId });
          }}
          onMoveTrack={(trackId, fromPlaylistId, toPlaylistId) => {
            if (fromPlaylistId === toPlaylistId) return;
            setTracksByPlaylist((prev) => {
              const from = prev[fromPlaylistId] ?? [];
              const moving = from.find((t) => t.id === trackId);
              if (!moving) return prev;
              return {
                ...prev,
                [fromPlaylistId]: from.filter((t) => t.id !== trackId),
                [toPlaylistId]: [...(prev[toPlaylistId] ?? []), moving],
              };
            });
          }}
          onImportTracks={(playlistId, imported) => {
            const restored: Track[] = imported.map((meta) => ({
              id: `restored-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              kind: 'local',
              title: meta.title,
              artist: meta.artist,
              fileName: meta.fileName,
              objectUrl: null,
            }));
            addTracksToPlaylist(playlistId, restored);
          }}
          onClose={() => setManagerOpen(false)}
        />
      )}
    </div>
  );

  return createPortal(body, document.body);
}

/** Music-note icon button for a toolbar — shared by StudioToolbar and the Text Editor's own bar so
 *  both open/close the exact same player instance via `MusicPlayerContext`. */
export function MusicPlayerToggleButton({ className = '' }: { className?: string }) {
  const { toggle } = useMusicPlayerVisibility();
  return (
    <button
      type="button"
      aria-label="Toggle music player"
      title="Music Player"
      onClick={toggle}
      className={`studio-interactive studio-focusable ${className}`}
    >
      <Music2 size={16} />
    </button>
  );
}
