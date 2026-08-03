import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Music2, X, ChevronUp, ChevronDown, Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, Volume2, VolumeX, Upload, ListMusic, Trash2, Link, Youtube,
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
import { swalToast } from '../../lib/swalTheme';
import { useFullscreenPortalTarget } from '../../lib/useFullscreenPortalTarget';
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
 *  A YouTube track similarly carries no audio data of its own — playback goes through the IFrame
 *  Player API instead (see `loadYouTubeIframeApi` below), single-video only: pasting a playlist
 *  URL is rejected with a clear message rather than expanded into a track list, since real
 *  playlist expansion needs the YouTube Data API and a configured API key, which this
 *  deliberately offline-first app doesn't carry (matching the Fonts panel's own no-Google-Fonts
 *  rationale). `kind` already existed as a real discriminant before Spotify/YouTube were added, so
 *  widening it here is additive, not a reshape. */
export interface Track {
  id: string;
  kind: 'local' | 'spotify' | 'youtube';
  title: string;
  artist?: string;
  duration?: number;
  // local-only
  fileName?: string;
  objectUrl?: string | null;
  /** Embedded ID3v2 APIC cover art, extracted at upload time — an object URL, or null/undefined
   *  when the file has no embedded art (or it couldn't be parsed), in which case a placeholder is
   *  shown instead. Session memory only, same lifetime as `objectUrl`. */
  artwork?: string | null;
  // spotify-only
  spotifyId?: string;
  spotifyType?: 'track' | 'playlist' | 'album';
  // youtube-only
  youtubeId?: string;
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

const YOUTUBE_ID_PATTERNS: RegExp[] = [
  /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/,
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
  /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
  /youtube\.com\/v\/([A-Za-z0-9_-]{11})/,
  /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
];

/** Extracts an 11-char video id from any of the standard YouTube URL shapes (watch/short-link/
 *  embed/legacy-v/shorts). A `watch?v=...&list=...` link still resolves the video id here — the
 *  video plays, the list is simply ignored, matching the single-video-only scope. */
export function extractYouTubeId(url: string): string | null {
  for (const pattern of YOUTUBE_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/** A bare `/playlist?list=...` link (no `v=` video id) has no single video to embed — distinguished
 *  from a `watch?v=...&list=...` link (which does resolve above) so the caller can show a real
 *  "playlists aren't supported" message instead of the generic "not a valid link" one. */
export function isYouTubePlaylistOnlyUrl(url: string): boolean {
  return /youtube\.com\/playlist\?/.test(url) && !extractYouTubeId(url);
}

export function getYouTubeThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

type ParsedMediaUrl = { track: Track } | { error: string };

let mediaUrlCounter = 0;

/** Parses one candidate URL (already trimmed) into a ready-to-add `Track`, or an error message —
 *  factored out of the add-link handler so a single paste containing several URLs (one per line,
 *  space- or comma-separated) can resolve each independently. */
function parseMediaUrl(url: string): ParsedMediaUrl | null {
  if (!url) return null;
  const spotify = parseSpotifyUrl(url);
  if (spotify) {
    return {
      track: {
        id: `spotify-${Date.now()}-${mediaUrlCounter++}-${Math.random().toString(36).slice(2)}`,
        kind: 'spotify',
        title: `Spotify ${spotify.type}`,
        spotifyId: spotify.id,
        spotifyType: spotify.type,
      },
    };
  }
  if (isYouTubePlaylistOnlyUrl(url)) {
    return { error: "Playlist links aren't supported — paste a single video link." };
  }
  const youtubeId = extractYouTubeId(url);
  if (youtubeId) {
    return {
      track: {
        id: `youtube-${Date.now()}-${mediaUrlCounter++}-${Math.random().toString(36).slice(2)}`,
        kind: 'youtube',
        title: `YouTube video ${youtubeId}`,
        youtubeId,
      },
    };
  }
  return { error: 'Not a valid Spotify or YouTube link.' };
}

function readSynchsafeInt(view: DataView, offset: number): number {
  return (
    ((view.getUint8(offset) & 0x7f) << 21) |
    ((view.getUint8(offset + 1) & 0x7f) << 14) |
    ((view.getUint8(offset + 2) & 0x7f) << 7) |
    (view.getUint8(offset + 3) & 0x7f)
  );
}

/** Best-effort ID3v2 APIC (attached picture) extractor for local audio uploads. Only reads the
 *  leading ID3v2 tag (embedded art always lives there, never scanned from the rest of the file),
 *  handles both plain (v2.2/2.3) and synchsafe (v2.4) frame sizes, and returns null — never
 *  throws — for anything it can't confidently parse, so the caller always has a placeholder to
 *  fall back to. */
async function extractArtworkFromFile(file: File): Promise<string | null> {
  try {
    const headerBuffer = await file.slice(0, 10).arrayBuffer();
    if (headerBuffer.byteLength < 10) return null;
    const headerView = new DataView(headerBuffer);
    if (headerView.getUint8(0) !== 0x49 || headerView.getUint8(1) !== 0x44 || headerView.getUint8(2) !== 0x33) {
      return null; // no "ID3" magic at the start of the file
    }
    const majorVersion = headerView.getUint8(3);
    const tagSize = readSynchsafeInt(headerView, 6);

    const tagBuffer = await file.slice(0, 10 + tagSize).arrayBuffer();
    const view = new DataView(tagBuffer);

    let offset = 10;
    while (offset + 10 <= tagBuffer.byteLength) {
      const frameId = String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3),
      );
      const frameSize = majorVersion >= 4 ? readSynchsafeInt(view, offset + 4) : view.getUint32(offset + 4);
      if (frameSize <= 0 || offset + 10 + frameSize > tagBuffer.byteLength) break;

      if (frameId === 'APIC') {
        let picOffset = offset + 10;
        picOffset += 1; // text-encoding byte
        const mimeStart = picOffset;
        while (picOffset < tagBuffer.byteLength && view.getUint8(picOffset) !== 0) picOffset++;
        const mimeBytes = new Uint8Array(tagBuffer, mimeStart, picOffset - mimeStart);
        const mimeType = mimeBytes.length > 0 ? String.fromCharCode(...mimeBytes) : 'image/jpeg';
        picOffset += 1; // null terminator
        picOffset += 1; // picture-type byte
        while (picOffset < tagBuffer.byteLength && view.getUint8(picOffset) !== 0) picOffset++; // description
        picOffset += 1; // null terminator

        const frameEnd = offset + 10 + frameSize;
        const imageLength = frameEnd - picOffset;
        if (imageLength <= 0) return null;
        const imageBytes = new Uint8Array(tagBuffer, picOffset, imageLength);
        const blob = new Blob([imageBytes], { type: mimeType });
        return URL.createObjectURL(blob);
      }

      offset += 10 + frameSize;
    }
    return null;
  } catch {
    return null;
  }
}

/** Minimal ambient typing for the parts of the YouTube IFrame Player API this app actually calls —
 *  no `@types/youtube` package is installed, and the full surface is much larger than what's used
 *  here. */
interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  loadVideoById(videoId: string): void;
  destroy(): void;
}
interface YouTubePlayerEvent {
  data: number;
}
interface YouTubePlayerOptions {
  videoId: string;
  events?: {
    onReady?: () => void;
    onStateChange?: (event: YouTubePlayerEvent) => void;
  };
}
interface YouTubeIframeApi {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
  PlayerState: { ENDED: number };
}
declare global {
  interface Window {
    YT?: YouTubeIframeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YouTubeIframeApi> | null = null;
/** Lazily loads the YouTube IFrame Player API script the first time it's actually needed —
 *  matching this app's existing lazy-load-on-first-use convention (e.g. spellcheck dictionaries)
 *  rather than paying for it on every session regardless of whether YouTube is ever used. */
function loadYouTubeIframeApi(): Promise<YouTubeIframeApi> {
  if (window.YT) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return youtubeApiPromise;
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

/** Spotify's embed iframe is fully sandboxed — it exposes no playback-position events to this app
 *  (confirmed: no `postMessage` API, no oEmbed duration field), so a real progress bar driven by
 *  actual playback position isn't possible. This simulates one from elapsed wall-clock time
 *  instead, scaled against a rough assumed track length purely so the bar has *some* visual
 *  motion — labeled "estimated" throughout so it never reads as authoritative. Resets whenever
 *  the current track changes. */
const SPOTIFY_ASSUMED_TRACK_SECONDS = 180;

function SpotifyProgressBar({ isPlaying, trackId }: { isPlaying: boolean; trackId: string }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(performance.now());

  useEffect(() => {
    setElapsed(0);
    startRef.current = performance.now();
  }, [trackId]);

  useEffect(() => {
    if (!isPlaying) return;
    startRef.current = performance.now() - elapsed * 1000;
    const interval = window.setInterval(() => {
      setElapsed((performance.now() - startRef.current) / 1000);
    }, 500);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  function handleSeekAttempt() {
    swalToast({ icon: 'info', title: 'Seeking is not supported for Spotify tracks' });
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        onPointerDown={handleSeekAttempt}
        title="Seeking is not supported for Spotify tracks"
        className="w-full h-1.5 rounded-full bg-ink/10 overflow-hidden cursor-not-allowed"
      >
        <div
          className="h-full bg-accent/70 transition-[width] duration-500 ease-linear"
          style={{ width: `${Math.min(100, (elapsed / SPOTIFY_ASSUMED_TRACK_SECONDS) * 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-micro text-ink-faint tabular-nums">
        <span>~{formatTime(elapsed)}</span>
        <span>(estimated)</span>
      </div>
    </div>
  );
}

/**
 * Floating, draggable music player — local file playback (Web Audio frequency-bar visualization),
 * multi-playlist management, shuffle/repeat, all state persisted (settings + playlist names only,
 * never track data — see musicPlayerStore.ts). Rendered as a `createPortal` to `document.body` so
 * it floats above Studio *and* the Text Editor equally, mounted once at the app root
 * (`App.tsx`) and toggled via `MusicPlayerContext` from either surface's own toolbar button.
 *
 * YouTube playback is real (single-video only, no playlist expansion — see the `Track` doc
 * comment above for why) via the IFrame Player API, alongside local files and the Spotify embed.
 */
export function MusicPlayer() {
  const { hidden, toggle } = useMusicPlayerVisibility();
  // Mounted once at the app root, outside any fullscreen-root subtree — without this, the player
  // portal-renders to `document.body` and disappears the instant Studio (or anything else) enters
  // the Fullscreen API, since `document.body` is no longer part of the active fullscreen element's
  // rendered subtree.
  const portalTarget = useFullscreenPortalTarget();
  const [persisted, setPersisted] = useState<MusicPlayerPersistedState>(() => loadMusicPlayerState());
  const [tracksByPlaylist, setTracksByPlaylist] = useState<Record<string, Track[]>>({ [DEFAULT_PLAYLIST_ID]: [] });
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [managerOpen, setManagerOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const [reorderIndex, setReorderIndex] = useState<number | null>(null);
  const [mediaUrlInput, setMediaUrlInput] = useState('');
  const [mediaUrlError, setMediaUrlError] = useState<string | null>(null);
  const [ytDuration, setYtDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const warnedAboutMissingRef = useRef(false);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YouTubePlayer | null>(null);

  const activePlaylistId = persisted.activePlaylistId ?? persisted.playlists[0]?.id ?? DEFAULT_PLAYLIST_ID;
  const tracks = tracksByPlaylist[activePlaylistId] ?? [];
  const currentIndex = tracks.findIndex((t) => t.id === currentTrackId);
  const currentTrack = currentIndex >= 0 ? tracks[currentIndex] : null;

  // Mirrors of the state above, kept in sync every render. The persistent <audio> element's
  // `ended` listener and the YouTube player's `onStateChange` callback are each registered exactly
  // once (empty-deps mount effect / first-track-only player construction) and never re-attached
  // per track — without these refs, the auto-play-next logic they call would forever see the
  // playlist/track/shuffle/repeat state as it existed at that one registration moment instead of
  // whatever it actually is when a track really ends.
  const tracksRef = useRef(tracks);
  const currentTrackIdRef = useRef(currentTrackId);
  const currentIndexRef = useRef(currentIndex);
  const shuffleRef = useRef(persisted.shuffle);
  const repeatRef = useRef(persisted.repeat);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { currentTrackIdRef.current = currentTrackId; }, [currentTrackId]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { shuffleRef.current = persisted.shuffle; }, [persisted.shuffle]);
  useEffect(() => { repeatRef.current = persisted.repeat; }, [persisted.repeat]);

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

  // --- YouTube player wiring ---------------------------------------------------
  // The player is created lazily against `ytContainerRef` the first time a youtube track is
  // actually selected (mirrors the local-audio effects' own track-id-keyed load shape above), not
  // eagerly on mount — no reason to load the IFrame API script for a session that never adds a
  // YouTube link.
  useEffect(() => {
    if (currentTrack?.kind !== 'youtube' || !currentTrack.youtubeId) return;
    let cancelled = false;
    const videoId = currentTrack.youtubeId;
    loadYouTubeIframeApi().then((YT) => {
      if (cancelled) return;
      const container = ytContainerRef.current;
      if (!container) return;
      if (!ytPlayerRef.current) {
        ytPlayerRef.current = new YT.Player(container, {
          videoId,
          events: {
            onReady: () => { if (isPlaying) ytPlayerRef.current?.playVideo(); },
            onStateChange: (event) => { if (event.data === YT.PlayerState.ENDED) handleTrackEnded(); },
          },
        });
      } else {
        ytPlayerRef.current.loadVideoById(videoId);
      }
      setCurrentTime(0);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentTrack?.kind, currentTrack?.youtubeId]);

  useEffect(() => {
    if (currentTrack?.kind !== 'youtube') return;
    const player = ytPlayerRef.current;
    if (!player) return;
    if (isPlaying) player.playVideo();
    else player.pauseVideo();
  }, [isPlaying, currentTrack?.kind]);

  // Polls current time/duration while a YouTube video plays — the IFrame API has no timeupdate-
  // style event, unlike the local `<audio>` element's own listener above.
  useEffect(() => {
    if (currentTrack?.kind !== 'youtube' || !isPlaying) return;
    const interval = window.setInterval(() => {
      const player = ytPlayerRef.current;
      if (!player) return;
      setCurrentTime(player.getCurrentTime());
      setYtDuration(player.getDuration());
    }, 500);
    return () => window.clearInterval(interval);
  }, [currentTrack?.kind, currentTrack?.id, isPlaying]);

  useEffect(() => {
    return () => { ytPlayerRef.current?.destroy(); ytPlayerRef.current = null; };
  }, []);

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

  function updateTrackArtwork(playlistId: string, trackId: string, artwork: string) {
    setTracksByPlaylist((prev) => {
      const list = prev[playlistId] ?? [];
      return { ...prev, [playlistId]: list.map((t) => (t.id === trackId ? { ...t, artwork } : t)) };
    });
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
      artwork: null,
    }));
    const playlistId = activePlaylistId;
    addTracksToPlaylist(playlistId, newTracks);
    if (!currentTrackId && newTracks.length > 0) setCurrentTrackId(newTracks[0].id);
    newTracks.forEach((track, i) => {
      extractArtworkFromFile(list[i])
        .then((artwork) => { if (artwork) updateTrackArtwork(playlistId, track.id, artwork); })
        .catch(() => {});
    });
  }

  function handleAddMediaUrl() {
    const rawUrls = mediaUrlInput.split(/[\n\r\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (rawUrls.length === 0) return;
    const newTracks: Track[] = [];
    const errors: string[] = [];
    for (const raw of rawUrls) {
      const result = parseMediaUrl(raw);
      if (!result) continue;
      if ('error' in result) errors.push(rawUrls.length > 1 ? `${raw} — ${result.error}` : result.error);
      else newTracks.push(result.track);
    }
    if (newTracks.some((t) => t.kind === 'youtube')) loadYouTubeIframeApi();
    if (newTracks.length > 0) {
      addTracksToPlaylist(activePlaylistId, newTracks);
      if (!currentTrackId) playTrack(newTracks[0].id);
      setMediaUrlInput('');
    }
    setMediaUrlError(errors.length > 0 ? errors.join('; ') : null);
  }

  const playTrack = useCallback((id: string) => {
    setCurrentTrackId(id);
    setIsPlaying(true);
  }, []);

  function handlePlayPause() {
    if (!currentTrack) {
      if (tracks.length > 0) playTrack(tracks[0].id);
      return;
    }
    setIsPlaying((p) => !p);
  }

  const pickNextIndex = useCallback((direction: 1 | -1): number | null => {
    const list = tracksRef.current;
    const idx = currentIndexRef.current;
    if (list.length === 0) return null;
    if (shuffleRef.current) {
      if (list.length === 1) return 0;
      let next = Math.floor(Math.random() * list.length);
      while (next === idx) next = Math.floor(Math.random() * list.length);
      return next;
    }
    const base = idx < 0 ? (direction === 1 ? -1 : 0) : idx;
    const next = base + direction;
    if (next < 0) return repeatRef.current === 'all' ? list.length - 1 : null;
    if (next >= list.length) return repeatRef.current === 'all' ? 0 : null;
    return next;
  }, []);

  const handleNext = useCallback(() => {
    const list = tracksRef.current;
    const next = pickNextIndex(1);
    if (next != null) playTrack(list[next].id);
    else setIsPlaying(false);
  }, [pickNextIndex, playTrack]);

  function handlePrev() {
    if (currentTrack?.kind === 'youtube') {
      const player = ytPlayerRef.current;
      if (player && player.getCurrentTime() > 3) { player.seekTo(0, true); setCurrentTime(0); return; }
    } else {
      const audio = audioRef.current;
      if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
    }
    const prev = pickNextIndex(-1);
    if (prev != null) playTrack(tracks[prev].id);
  }

  const handleTrackEnded = useCallback(() => {
    const list = tracksRef.current;
    const current = list.find((t) => t.id === currentTrackIdRef.current) ?? null;
    if (repeatRef.current === 'one') {
      if (current?.kind === 'youtube') {
        const player = ytPlayerRef.current;
        if (player) { player.seekTo(0, true); player.playVideo(); }
        return;
      }
      const audio = audioRef.current;
      if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
      return;
    }
    handleNext();
  }, [handleNext]);

  function handleDeleteTrack(id: string) {
    setTracksByPlaylist((prev) => {
      const list = prev[activePlaylistId] ?? [];
      const track = list.find((t) => t.id === id);
      if (track?.objectUrl) URL.revokeObjectURL(track.objectUrl);
      if (track?.artwork) URL.revokeObjectURL(track.artwork);
      return { ...prev, [activePlaylistId]: list.filter((t) => t.id !== id) };
    });
    if (id === currentTrackId) { setCurrentTrackId(null); setIsPlaying(false); }
  }

  function handleClearAll() {
    const list = tracksByPlaylist[activePlaylistId] ?? [];
    list.forEach((t) => {
      if (t.objectUrl) URL.revokeObjectURL(t.objectUrl);
      if (t.artwork) URL.revokeObjectURL(t.artwork);
    });
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
  const duration = currentTrack?.kind === 'youtube' ? ytDuration : (currentTrack?.duration ?? audioRef.current?.duration ?? 0);

  const seekTo = useCallback((fraction: number) => {
    if (currentTrack?.kind === 'youtube') {
      const player = ytPlayerRef.current;
      const dur = player?.getDuration() ?? 0;
      if (player && dur > 0) { player.seekTo(fraction * dur, true); setCurrentTime(fraction * dur); }
      return;
    }
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = fraction * audio.duration;
    setCurrentTime(audio.currentTime);
  }, [currentTrack?.kind]);

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

      {/* Always-mounted media embeds: an unmounted iframe stops its embedded playback outright,
          regardless of whether anything ever calls `.pause()` on it — so the Spotify iframe and
          the YouTube player's container must stay in the DOM across a minimize toggle. Only
          visually hidden (`hidden` = display:none, not removed) while minimized; the rest of the
          chrome below (which holds no playback state of its own) is still fine to unmount. */}
      <div className={persisted.minimized ? 'hidden' : ''}>
        {currentTrack?.kind === 'spotify' && currentTrack.spotifyId && currentTrack.spotifyType && (
          <div className="px-3 pt-3">
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
          </div>
        )}
        <div
          ref={ytContainerRef}
          className={currentTrack?.kind === 'youtube' ? 'aspect-video w-full' : 'hidden'}
        />
      </div>

      {!persisted.minimized && (
        <div className="p-3 flex flex-col gap-3">
          <div className="flex gap-3">
            {/* Cover art: local files show their embedded ID3 APIC art when extraction succeeded,
                otherwise a generic placeholder — YouTube tracks get their real video thumbnail,
                falling back to the same placeholder if it fails to load; Spotify tracks show their
                own art via the embed above, so no placeholder is drawn here for them. */}
            {currentTrack?.kind === 'youtube' && currentTrack.youtubeId ? (
              <div className="w-20 h-20 shrink-0 rounded-lg border border-hairline bg-ink/5 relative overflow-hidden">
                <img
                  src={getYouTubeThumbnail(currentTrack.youtubeId)}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                    if (fallback) fallback.style.display = 'flex';
                  }}
                />
                <div className="hidden absolute inset-0 items-center justify-center text-ink-faint">
                  <Music2 size={28} />
                </div>
              </div>
            ) : currentTrack?.kind === 'local' && currentTrack.artwork ? (
              <div className="w-20 h-20 shrink-0 rounded-lg border border-hairline bg-ink/5 overflow-hidden">
                <img src={currentTrack.artwork} alt="" className="w-full h-full object-cover" />
              </div>
            ) : currentTrack?.kind !== 'spotify' && (
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

          {currentTrack?.kind === 'spotify' ? (
            // The embed owns its own transport/volume/artwork entirely — this app's own seek bar,
            // play/pause, and volume slider only ever drive the <audio> element, which has nothing
            // loaded while a Spotify track is current (see the objectUrl-gated effects above), so
            // none of that chrome would do anything meaningful here.
            <SpotifyProgressBar isPlaying={isPlaying} trackId={currentTrack.id} />
          ) : (
            <>
              {/* Frequency-bar visualizer stays local-only — there's no Web Audio access into a
                  cross-origin YouTube iframe to analyze. */}
              {currentTrack?.kind !== 'youtube' && (
                <canvas ref={canvasRef} width={296} height={48} className="w-full h-12 rounded-md bg-ink/5" />
              )}

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
                  {t.kind === 'youtube' && (
                    <span title="YouTube" className="shrink-0 text-red-500">
                      <Youtube size={12} />
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
                value={mediaUrlInput}
                onChange={(e) => { setMediaUrlInput(e.target.value); setMediaUrlError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddMediaUrl(); }}
                placeholder="Paste a Spotify or YouTube link…"
                aria-label="Spotify or YouTube URL"
                className={`flex-1 min-w-0 bg-ink/5 border rounded-control px-2 py-1.5 text-micro text-ink ${mediaUrlError ? 'border-red-400' : 'border-hairline'}`}
              />
              <button
                type="button"
                aria-label="Add link"
                title="Add link"
                onClick={handleAddMediaUrl}
                disabled={!mediaUrlInput.trim()}
                className="studio-interactive studio-focusable shrink-0 w-8 h-8 flex items-center justify-center rounded-md border border-hairline text-ink disabled:opacity-40 disabled:pointer-events-none"
              >
                <Link size={13} />
              </button>
            </div>
            {mediaUrlError && <div className="text-micro text-red-400 mt-1">{mediaUrlError}</div>}
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

  return createPortal(body, portalTarget);
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
