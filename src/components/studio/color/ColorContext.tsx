import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadPalettes, savePalettes, type ColorPalette } from '../../../lib/paletteStore';

interface ColorContextValue {
  foreground: string;
  background: string;
  recent: string[];
  setForeground: (hex: string) => void;
  setBackground: (hex: string) => void;
  swap: () => void;
  reset: () => void;
  palettes: ColorPalette[];
  activePaletteId: string | null;
  setActivePaletteId: (id: string | null) => void;
  createPalette: (name: string) => void;
  deletePalette: (id: string) => void;
  addSwatch: (paletteId: string, hex: string) => void;
  removeSwatch: (paletteId: string, hex: string) => void;
}

const DEFAULT_FG = '#000000';
const DEFAULT_BG = '#ffffff';

const ColorContext = createContext<ColorContextValue | null>(null);

let paletteIdCounter = 0;
function genPaletteId() {
  paletteIdCounter += 1;
  return `palette-${Date.now()}-${paletteIdCounter}`;
}

export function ColorProvider({ children }: { children: ReactNode }) {
  const [foreground, setForegroundState] = useState(DEFAULT_FG);
  const [background, setBackgroundState] = useState(DEFAULT_BG);
  const [recent, setRecent] = useState<string[]>([]);
  const [palettes, setPalettes] = useState<ColorPalette[]>([]);
  const [activePaletteId, setActivePaletteId] = useState<string | null>(null);

  useEffect(() => {
    loadPalettes().then(saved => {
      setPalettes(saved);
      if (saved.length > 0) setActivePaletteId(saved[0].id);
    });
  }, []);

  const remember = useCallback((hex: string) => {
    setRecent(prev => [hex, ...prev.filter(c => c !== hex)].slice(0, 12));
  }, []);

  const setForeground = useCallback((hex: string) => { setForegroundState(hex); remember(hex); }, [remember]);
  const setBackground = useCallback((hex: string) => { setBackgroundState(hex); remember(hex); }, [remember]);
  const swap = useCallback(() => {
    setForegroundState(prevFg => { setBackgroundState(prevFg); return background; });
  }, [background]);
  const reset = useCallback(() => { setForegroundState(DEFAULT_FG); setBackgroundState(DEFAULT_BG); }, []);

  const createPalette = useCallback((name: string) => {
    const palette: ColorPalette = { id: genPaletteId(), name, colors: [] };
    setPalettes(prev => {
      const next = [...prev, palette];
      void savePalettes(next);
      return next;
    });
    setActivePaletteId(palette.id);
  }, []);

  const deletePalette = useCallback((id: string) => {
    setPalettes(prev => {
      const next = prev.filter(p => p.id !== id);
      void savePalettes(next);
      return next;
    });
    setActivePaletteId(prev => (prev === id ? null : prev));
  }, []);

  const addSwatch = useCallback((paletteId: string, hex: string) => {
    setPalettes(prev => {
      const next = prev.map(p => p.id === paletteId && !p.colors.includes(hex) ? { ...p, colors: [...p.colors, hex] } : p);
      void savePalettes(next);
      return next;
    });
  }, []);

  const removeSwatch = useCallback((paletteId: string, hex: string) => {
    setPalettes(prev => {
      const next = prev.map(p => p.id === paletteId ? { ...p, colors: p.colors.filter(c => c !== hex) } : p);
      void savePalettes(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({
    foreground, background, recent, setForeground, setBackground, swap, reset,
    palettes, activePaletteId, setActivePaletteId, createPalette, deletePalette, addSwatch, removeSwatch,
  }), [foreground, background, recent, setForeground, setBackground, swap, reset,
    palettes, activePaletteId, createPalette, deletePalette, addSwatch, removeSwatch]);

  return <ColorContext.Provider value={value}>{children}</ColorContext.Provider>;
}

export function useColor(): ColorContextValue {
  const ctx = useContext(ColorContext);
  if (!ctx) throw new Error('useColor must be used within a ColorProvider');
  return ctx;
}
