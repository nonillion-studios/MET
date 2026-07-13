import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_DOCK_REGION, type DockRegionId } from './dockLayout';

export interface FloatingRect { x: number; y: number; width: number; height: number; }

interface DockContextValue {
  activeTab: Record<DockRegionId, string | null>;
  homeRegion: Record<string, DockRegionId>;
  floating: Record<string, FloatingRect>;
  isFloating: (tabId: string) => boolean;
  /** Activates a tab wherever it currently lives (its dock region); no-op if it's floating (already visible). */
  selectTab: (tabId: string) => void;
  setActiveTab: (region: DockRegionId, tabId: string) => void;
  floatTab: (tabId: string) => void;
  dockBack: (tabId: string) => void;
  updateFloatingRect: (tabId: string, rect: FloatingRect) => void;
}

const DockContext = createContext<DockContextValue | null>(null);

const DEFAULT_RECT: FloatingRect = { x: 120, y: 100, width: 280, height: 360 };

export function DockProvider({ children }: { children: ReactNode }) {
  const [homeRegion] = useState<Record<string, DockRegionId>>({ ...DEFAULT_DOCK_REGION });
  const [activeTab, setActiveTabState] = useState<Record<DockRegionId, string | null>>({ top: 'layers', bottom: 'typer' });
  const [floating, setFloating] = useState<Record<string, FloatingRect>>({});

  const setActiveTab = useCallback((region: DockRegionId, tabId: string) => {
    setActiveTabState(prev => ({ ...prev, [region]: tabId }));
  }, []);

  const isFloating = useCallback((tabId: string) => tabId in floating, [floating]);

  const selectTab = useCallback((tabId: string) => {
    if (tabId in floating) return;
    const region = homeRegion[tabId] ?? 'bottom';
    setActiveTab(region, tabId);
  }, [floating, homeRegion, setActiveTab]);

  const floatTab = useCallback((tabId: string) => {
    setFloating(prev => ({ ...prev, [tabId]: prev[tabId] ?? { ...DEFAULT_RECT, x: DEFAULT_RECT.x + Object.keys(prev).length * 24, y: DEFAULT_RECT.y + Object.keys(prev).length * 24 } }));
  }, []);

  const dockBack = useCallback((tabId: string) => {
    setFloating(prev => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    const region = homeRegion[tabId] ?? 'bottom';
    setActiveTab(region, tabId);
  }, [homeRegion, setActiveTab]);

  const updateFloatingRect = useCallback((tabId: string, rect: FloatingRect) => {
    setFloating(prev => (tabId in prev ? { ...prev, [tabId]: rect } : prev));
  }, []);

  const value = useMemo(() => ({
    activeTab, homeRegion, floating, isFloating, selectTab, setActiveTab, floatTab, dockBack, updateFloatingRect,
  }), [activeTab, homeRegion, floating, isFloating, selectTab, setActiveTab, floatTab, dockBack, updateFloatingRect]);

  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

export function useDock(): DockContextValue {
  const ctx = useContext(DockContext);
  if (!ctx) throw new Error('useDock must be used within a DockProvider');
  return ctx;
}
