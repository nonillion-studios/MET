import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
const DEFAULT_ACTIVE_TAB: Record<DockRegionId, string | null> = { top: 'layers', bottom: 'typer' };

interface PersistedDockLayout {
  activeTab: Record<DockRegionId, string | null>;
  floating: Record<string, FloatingRect>;
}

function loadPersistedLayout(storageKey: string | undefined): PersistedDockLayout | null {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(`dock_layout_${storageKey}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

interface DockProviderProps {
  children: ReactNode;
  /** Scopes remembered panel layout (active tabs, floating panel positions) to a project — e.g. a chapter id. */
  storageKey?: string;
}

export function DockProvider({ children, storageKey }: DockProviderProps) {
  // homeRegion is currently fixed at its default (no UI mutates it), so it doesn't need persisting.
  const [homeRegion] = useState<Record<string, DockRegionId>>({ ...DEFAULT_DOCK_REGION });
  const [activeTab, setActiveTabState] = useState<Record<DockRegionId, string | null>>(
    () => loadPersistedLayout(storageKey)?.activeTab ?? DEFAULT_ACTIVE_TAB
  );
  const [floating, setFloating] = useState<Record<string, FloatingRect>>(
    () => loadPersistedLayout(storageKey)?.floating ?? {}
  );

  // Re-seed from storage whenever the project changes (storageKey is stable for a given Studio mount
  // in practice, but this keeps the provider correct if that ever changes).
  const lastKeyRef = useRef(storageKey);
  useEffect(() => {
    if (lastKeyRef.current === storageKey) return;
    lastKeyRef.current = storageKey;
    const persisted = loadPersistedLayout(storageKey);
    setActiveTabState(persisted?.activeTab ?? DEFAULT_ACTIVE_TAB);
    setFloating(persisted?.floating ?? {});
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(`dock_layout_${storageKey}`, JSON.stringify({ activeTab, floating }));
      } catch {
        // Storage full/unavailable — layout just won't persist this time, not fatal.
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [storageKey, activeTab, floating]);

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
