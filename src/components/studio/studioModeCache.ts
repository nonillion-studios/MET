import type { Selection } from './paint/selection';

/**
 * Transient per-chapter Studio UI state (viewport/selection/active layer/tool/page) that would
 * otherwise be lost every time `Studio` unmounts — e.g. switching to Design Mode and back, a plain
 * tab swap in `App.tsx` with no keep-alive. Layers themselves already survive that round trip via
 * the existing chapter autosave/load (`studioProjectStore.ts`); this only covers what autosave
 * deliberately doesn't persist (session-local UI state, not project data). A plain in-memory
 * module-level `Map`, not localStorage/IndexedDB — this is scoped to "don't lose it when you tab
 * away and back", not "restore it after a full page reload".
 */
export interface StudioModeCacheEntry {
  activePageId: string | null;
  viewport: { scale: number; centerX: number; centerY: number } | null;
  selectionByPage: Record<string, Selection>;
  selectedLayerIds: string[];
  activeTool: string;
}

const cache = new Map<string, StudioModeCacheEntry>();

export function saveStudioModeState(chapterId: string, entry: StudioModeCacheEntry): void {
  cache.set(chapterId, entry);
}

export function loadStudioModeState(chapterId: string): StudioModeCacheEntry | undefined {
  return cache.get(chapterId);
}
