import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface ColorContextValue {
  foreground: string;
  background: string;
  recent: string[];
  setForeground: (hex: string) => void;
  setBackground: (hex: string) => void;
  swap: () => void;
  reset: () => void;
}

const DEFAULT_FG = '#000000';
const DEFAULT_BG = '#ffffff';

const ColorContext = createContext<ColorContextValue | null>(null);

export function ColorProvider({ children }: { children: ReactNode }) {
  const [foreground, setForegroundState] = useState(DEFAULT_FG);
  const [background, setBackgroundState] = useState(DEFAULT_BG);
  const [recent, setRecent] = useState<string[]>([]);

  const remember = useCallback((hex: string) => {
    setRecent(prev => [hex, ...prev.filter(c => c !== hex)].slice(0, 12));
  }, []);

  const setForeground = useCallback((hex: string) => { setForegroundState(hex); remember(hex); }, [remember]);
  const setBackground = useCallback((hex: string) => { setBackgroundState(hex); remember(hex); }, [remember]);
  const swap = useCallback(() => {
    setForegroundState(prevFg => { setBackgroundState(prevFg); return background; });
  }, [background]);
  const reset = useCallback(() => { setForegroundState(DEFAULT_FG); setBackgroundState(DEFAULT_BG); }, []);

  const value = useMemo(() => ({ foreground, background, recent, setForeground, setBackground, swap, reset }),
    [foreground, background, recent, setForeground, setBackground, swap, reset]);

  return <ColorContext.Provider value={value}>{children}</ColorContext.Provider>;
}

export function useColor(): ColorContextValue {
  const ctx = useContext(ColorContext);
  if (!ctx) throw new Error('useColor must be used within a ColorProvider');
  return ctx;
}
