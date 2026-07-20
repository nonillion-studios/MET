import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface DockContextValue {
  activeTab: string | null;
  selectTab: (tabId: string) => void;
}

const DockContext = createContext<DockContextValue | null>(null);

// 'layers' and 'color' used to be dock tabs and are now their own always-visible panels outside
// this context (see Studio.tsx's toolsSidebar). 'typer' is the default for when nothing is
// selected yet. ('history' looked like a safer, content-free default — TypeR/Translation both
// carry a script/free-text textarea a text-layer-selection default could collide with — but the
// History panel's own entries are labeled with the exact same action names their own buttons use
// ("Add Layer", "Add Adjustment Layer", ...), so having it open by default doubled up almost every
// `getByRole('button', { name: ... })` locator in the e2e suite with a strict-mode violation the
// moment any history existed. 'typer' has no such collision.)
const DEFAULT_ACTIVE_TAB = 'typer';

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
