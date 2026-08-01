import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { loadMusicPlayerState } from './musicPlayerStore';

interface MusicPlayerVisibilityContextValue {
  hidden: boolean;
  toggle: () => void;
  show: () => void;
}

const MusicPlayerVisibilityContext = createContext<MusicPlayerVisibilityContextValue | null>(null);

/**
 * The music-note toggle button lives in two unrelated places (StudioToolbar, the Text Editor's own
 * toolbar) while the player itself mounts once, globally, in `App.tsx`. This context is the single
 * source of truth for "is it hidden" so all three agree — `MusicPlayer.tsx` reads it instead of
 * keeping its own separate hidden flag, which would otherwise let a toolbar button and the panel's
 * own close button drift out of sync.
 */
export function MusicPlayerVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(() => loadMusicPlayerState().hidden);

  const toggle = useCallback(() => setHidden((prev) => !prev), []);
  const show = useCallback(() => setHidden(false), []);

  return (
    <MusicPlayerVisibilityContext.Provider value={{ hidden, toggle, show }}>
      {children}
    </MusicPlayerVisibilityContext.Provider>
  );
}

export function useMusicPlayerVisibility(): MusicPlayerVisibilityContextValue {
  const ctx = useContext(MusicPlayerVisibilityContext);
  if (!ctx) throw new Error('useMusicPlayerVisibility must be used within a MusicPlayerVisibilityProvider');
  return ctx;
}
