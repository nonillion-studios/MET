/**
 * Music player persistence — plain `localStorage`, per the spec's own instruction (every other
 * persisted Studio feature in this app uses `idb-keyval` instead; this one deliberately doesn't,
 * since nothing here needs to survive as more than a few hundred bytes of settings).
 *
 * Track data itself is **never** persisted. Local files live only as `URL.createObjectURL()`
 * references, which die on reload by construction — there is no IndexedDB blob store backing this
 * feature, so a `Track` can't be reconstructed after a refresh regardless of what's in
 * `localStorage`. Only playlist *names* and player settings persist; each playlist's track list
 * comes back empty after a reload, and the player surfaces that explicitly (see `MusicPlayer.tsx`)
 * rather than silently losing tracks with no explanation.
 */

const STORAGE_KEY = 'music_player_state';
const SCHEMA_VERSION = 1;

export type RepeatMode = 'off' | 'all' | 'one';

export interface PersistedPlaylistMeta {
  id: string;
  name: string;
}

export interface MusicPlayerPersistedState {
  schemaVersion: number;
  position: { x: number; y: number };
  minimized: boolean;
  hidden: boolean;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  playlists: PersistedPlaylistMeta[];
  activePlaylistId: string | null;
}

export const DEFAULT_PLAYLIST_ID = 'default';

function defaultState(): MusicPlayerPersistedState {
  return {
    schemaVersion: SCHEMA_VERSION,
    position: { x: 24, y: 24 },
    minimized: false,
    hidden: true,
    volume: 0.8,
    muted: false,
    shuffle: false,
    repeat: 'off',
    playlists: [{ id: DEFAULT_PLAYLIST_ID, name: 'My Playlist' }],
    activePlaylistId: DEFAULT_PLAYLIST_ID,
  };
}

export function loadMusicPlayerState(): MusicPlayerPersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<MusicPlayerPersistedState>;
    const base = defaultState();
    return {
      ...base,
      ...parsed,
      position: parsed.position ?? base.position,
      playlists: Array.isArray(parsed.playlists) && parsed.playlists.length > 0 ? parsed.playlists : base.playlists,
    };
  } catch {
    return defaultState();
  }
}

export function saveMusicPlayerState(state: MusicPlayerPersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full/unavailable — settings just won't persist this session, nothing to recover from.
  }
}
