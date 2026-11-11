import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PANEL_REGISTRY, PANEL_BY_ID, PANEL_IDS } from './panelRegistry';

function defaultLayout(): PanelLayoutState {
  const order = [...PANEL_IDS];
  const collapsed: Record<string, boolean> = {};
  const visible: Record<string, boolean> = {};
  const height: Record<string, number> = {};
  for (const def of PANEL_REGISTRY) {
    collapsed[def.id] = def.defaultCollapsed;
    visible[def.id] = def.defaultVisible;
    if (!def.grow) height[def.id] = def.defaultHeight;
  }
  return { order, collapsed, visible, height };
}

interface PanelLayoutState {
  order: string[];
  collapsed: Record<string, boolean>;
  visible: Record<string, boolean>;
  /** Absent for `grow` panels (Layers) — they flex-fill remaining space instead of storing one. */
  height: Record<string, number>;
}

// v1 had no `height` field at all (panel height was purely content-driven, capped at a flat
// 320px). v2 adds explicit per-panel height + the resize-divider system — a v1 layout is migrated
// forward (order/collapsed/visible preserved, height backfilled from the registry) rather than
// hard-reset, so upgrading doesn't discard a user's saved order/collapsed/visible just for one new
// field.
const SCHEMA_VERSION = 2;
interface StoredLayoutV2 { v: 2; order: string[]; collapsed: Record<string, boolean>; visible: Record<string, boolean>; height: Record<string, number>; }
interface StoredLayoutV1 { v: 1; order: string[]; collapsed: Record<string, boolean>; visible: Record<string, boolean>; }
type StoredLayout = StoredLayoutV2 | StoredLayoutV1;

function loadLayout(storageKey: string | undefined): PanelLayoutState {
  const fallback = defaultLayout();
  if (!storageKey) return fallback;
  try {
    const raw = localStorage.getItem(`studio_panel_layout_${storageKey}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as StoredLayout;
    if (parsed.v !== 1 && parsed.v !== SCHEMA_VERSION) return fallback;
    // A panel id this saved layout has never heard of (introduced since, or never touched by the
    // user) still needs a real default rather than silently vanishing from `order`.
    const order = [...parsed.order.filter(id => PANEL_IDS.includes(id)), ...PANEL_IDS.filter(id => !parsed.order.includes(id))];
    const height = { ...fallback.height, ...(parsed.v === SCHEMA_VERSION ? parsed.height : {}) };
    return {
      order,
      collapsed: { ...fallback.collapsed, ...parsed.collapsed },
      visible: { ...fallback.visible, ...parsed.visible },
      height,
    };
  } catch {
    return fallback;
  }
}

const DEFAULT_DOCK_WIDTH = 288;
const MIN_DOCK_WIDTH = 220;
const MAX_DOCK_WIDTH = 480;

interface PanelLayoutContextValue {
  order: string[];
  isVisible: (id: string) => boolean;
  isCollapsed: (id: string) => boolean;
  /** Undefined for a `grow` panel (Layers), which has no stored height. */
  heightOf: (id: string) => number | undefined;
  setVisible: (id: string, visible: boolean) => void;
  toggleCollapsed: (id: string) => void;
  /** Makes a panel visible and expanded — the panel-stack successor to the old dock's "select this
   *  tab": there's no single active tab anymore, so "reveal" is the closest real equivalent. */
  reveal: (id: string) => void;
  reorder: (draggedId: string, targetId: string, before: boolean) => void;
  /** Adjusts two adjacent panels' stored heights by `delta` (grows `aboveId`, shrinks `belowId`),
   *  clamped so neither passes its registry `minHeight`. A `grow` neighbor (Layers) has no stored
   *  height to adjust — its side of the drag is a no-op, since its flex sizing already absorbs
   *  whatever the fixed-height side gives up. */
  resizeAdjacent: (aboveId: string, belowId: string, delta: number) => void;
  /** Resets one panel back to its registry default height. No-op for a `grow` panel. */
  resetHeight: (id: string) => void;
  maximizedId: string | null;
  toggleMaximized: (id: string) => void;
  resetLayout: () => void;
  dockWidth: number;
  resizeDock: (delta: number) => void;
}

const PanelLayoutContext = createContext<PanelLayoutContextValue | null>(null);

interface PanelLayoutProviderProps {
  children: ReactNode;
  /** Scopes the remembered layout to a project — e.g. a chapter id. */
  storageKey?: string;
}

export function PanelLayoutProvider({ children, storageKey }: PanelLayoutProviderProps) {
  const [state, setState] = useState<PanelLayoutState>(() => loadLayout(storageKey));
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const [dockWidth, setDockWidth] = useState<number>(() => {
    if (!storageKey) return DEFAULT_DOCK_WIDTH;
    try {
      const v = localStorage.getItem(`studio_dock_width_${storageKey}`);
      return v ? Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, Number(v))) : DEFAULT_DOCK_WIDTH;
    } catch { return DEFAULT_DOCK_WIDTH; }
  });

  const lastKeyRef = useRef(storageKey);
  useEffect(() => {
    if (lastKeyRef.current === storageKey) return;
    lastKeyRef.current = storageKey;
    setState(loadLayout(storageKey));
    setMaximizedId(null);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    const timeout = setTimeout(() => {
      try {
        const stored: StoredLayoutV2 = { v: SCHEMA_VERSION, order: state.order, collapsed: state.collapsed, visible: state.visible, height: state.height };
        localStorage.setItem(`studio_panel_layout_${storageKey}`, JSON.stringify(stored));
      } catch {
        // Storage full/unavailable — layout just won't persist this time, not fatal.
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [storageKey, state]);

  const isVisible = useCallback((id: string) => state.visible[id] ?? false, [state.visible]);
  const isCollapsed = useCallback((id: string) => state.collapsed[id] ?? false, [state.collapsed]);
  const heightOf = useCallback((id: string) => state.height[id], [state.height]);

  const setVisible = useCallback((id: string, visible: boolean) => {
    setState(s => ({ ...s, visible: { ...s.visible, [id]: visible } }));
  }, []);

  const toggleCollapsed = useCallback((id: string) => {
    setState(s => ({ ...s, collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } }));
  }, []);

  const reveal = useCallback((id: string) => {
    setState(s => ({ ...s, visible: { ...s.visible, [id]: true }, collapsed: { ...s.collapsed, [id]: false } }));
  }, []);

  const reorder = useCallback((draggedId: string, targetId: string, before: boolean) => {
    if (draggedId === targetId) return;
    setState(s => {
      const withoutDragged = s.order.filter(id => id !== draggedId);
      const targetIndex = withoutDragged.indexOf(targetId);
      if (targetIndex === -1) return s;
      const insertAt = before ? targetIndex : targetIndex + 1;
      const nextOrder = [...withoutDragged.slice(0, insertAt), draggedId, ...withoutDragged.slice(insertAt)];
      return { ...s, order: nextOrder };
    });
  }, []);

  const resizeAdjacent = useCallback((aboveId: string, belowId: string, delta: number) => {
    setState(s => {
      const aboveDef = PANEL_BY_ID.get(aboveId);
      const belowDef = PANEL_BY_ID.get(belowId);
      const height = { ...s.height };
      if (aboveDef && !aboveDef.grow) {
        const current = height[aboveId] ?? aboveDef.defaultHeight;
        height[aboveId] = Math.max(aboveDef.minHeight, current + delta);
      }
      if (belowDef && !belowDef.grow) {
        const current = height[belowId] ?? belowDef.defaultHeight;
        height[belowId] = Math.max(belowDef.minHeight, current - delta);
      }
      return { ...s, height };
    });
  }, []);

  const resetHeight = useCallback((id: string) => {
    const def = PANEL_BY_ID.get(id);
    if (!def || def.grow) return;
    setState(s => ({ ...s, height: { ...s.height, [id]: def.defaultHeight } }));
  }, []);

  const toggleMaximized = useCallback((id: string) => {
    setMaximizedId(current => (current === id ? null : id));
  }, []);

  const resetLayout = useCallback(() => {
    setState(defaultLayout());
    setMaximizedId(null);
    setDockWidth(DEFAULT_DOCK_WIDTH);
  }, []);

  const resizeDock = useCallback((delta: number) => {
    setDockWidth(w => Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, w + delta)));
  }, []);

  useEffect(() => {
    if (!storageKey) return;
    const timeout = setTimeout(() => {
      try { localStorage.setItem(`studio_dock_width_${storageKey}`, String(dockWidth)); } catch {}
    }, 400);
    return () => clearTimeout(timeout);
  }, [storageKey, dockWidth]);

  const value = useMemo<PanelLayoutContextValue>(() => ({
    order: state.order, isVisible, isCollapsed, heightOf, setVisible, toggleCollapsed, reveal, reorder,
    resizeAdjacent, resetHeight, maximizedId, toggleMaximized, resetLayout, dockWidth, resizeDock,
  }), [state.order, isVisible, isCollapsed, heightOf, setVisible, toggleCollapsed, reveal, reorder, resizeAdjacent, resetHeight, maximizedId, toggleMaximized, resetLayout, dockWidth, resizeDock]);

  return <PanelLayoutContext.Provider value={value}>{children}</PanelLayoutContext.Provider>;
}

export function usePanelLayout(): PanelLayoutContextValue {
  const ctx = useContext(PanelLayoutContext);
  if (!ctx) throw new Error('usePanelLayout must be used within a PanelLayoutProvider');
  return ctx;
}
