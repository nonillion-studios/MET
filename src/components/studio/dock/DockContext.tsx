import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface DockContextValue {
  activeTab: string | null;
  selectTab: (tabId: string) => void;
}

const DockContext = createContext<DockContextValue | null>(null);

// 'layers' used to be a dock tab and is now its own always-visible panel outside this context.
// 'history' is a neutral, content-free default for when nothing is selected yet — TypeR/Translation
// both carry a script/free-text textarea that a text-layer-selection default would collide with the
// very moment a text layer gets selected (RightDock falls back to tabs[0] until then).
const DEFAULT_ACTIVE_TAB = 'history';

function loadPersistedTab(storageKey: string | undefined): string | null {
  if (!storageKey) return null;
  try {
    return localStorage.getItem(`studio_right_panel_${storageKey}`);
  } catch {
    return null;
  }
}

interface DockProviderProps {
  children: ReactNode;
  /** Scopes the remembered active right-sidebar panel to a project — e.g. a chapter id. */
  storageKey?: string;
}

export function DockProvider({ children, storageKey }: DockProviderProps) {
  const [activeTab, setActiveTabState] = useState<string | null>(
    () => loadPersistedTab(storageKey) ?? DEFAULT_ACTIVE_TAB
  );

  // Re-seed from storage whenever the project changes (storageKey is stable for a given Studio mount
  // in practice, but this keeps the provider correct if that ever changes).
  const lastKeyRef = useRef(storageKey);
  useEffect(() => {
    if (lastKeyRef.current === storageKey) return;
    lastKeyRef.current = storageKey;
    setActiveTabState(loadPersistedTab(storageKey) ?? DEFAULT_ACTIVE_TAB);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !activeTab) return;
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(`studio_right_panel_${storageKey}`, activeTab);
      } catch {
        // Storage full/unavailable — layout just won't persist this time, not fatal.
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [storageKey, activeTab]);

  const selectTab = useCallback((tabId: string) => setActiveTabState(tabId), []);

  const value = useMemo(() => ({ activeTab, selectTab }), [activeTab, selectTab]);

  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

export function useDock(): DockContextValue {
  const ctx = useContext(DockContext);
  if (!ctx) throw new Error('useDock must be used within a DockProvider');
  return ctx;
}
