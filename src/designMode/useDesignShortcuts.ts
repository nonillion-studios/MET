import { useEffect, useMemo } from 'react';
import { buildToolShortcutMap } from '../components/studio/shortcuts/shortcutsMap';

interface UseDesignShortcutsArgs {
  onToolChange: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onNewCanvas: () => void;
  onDuplicateActiveLayer: () => void;
  onDeleteActiveLayer: () => void;
  onZoomFit: () => void;
  onZoom100: () => void;
}

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

/**
 * Design Mode's own keyboard shortcuts. Tool hotkeys (V/B/E/T/M/L/...) reuse
 * `buildToolShortcutMap()` — the same key->tool-id table `ToolRail`'s own tools already carry via
 * `STUDIO_TOOL_GROUPS` — rather than hand-rolling a second one; a key for a tool this pass doesn't
 * implement interaction for just switches `activeTool` the same harmless way clicking its (reused,
 * unforked) ToolRail button already does.
 *
 * Only ever mounted while `DesignMode` itself is mounted, and the app already fully unmounts one nav
 * tab's view before mounting another (confirmed: Studio's own shortcuts hook only lives inside
 * Studio.tsx the same way) — so there's no possibility of this hook's listener overlapping with
 * Studio's, no extra guard needed beyond that natural lifecycle.
 */
export function useDesignShortcuts({
  onToolChange, onUndo, onRedo, onNewCanvas, onDuplicateActiveLayer, onDeleteActiveLayer, onZoomFit, onZoom100,
}: UseDesignShortcutsArgs) {
  const toolMap = useMemo(() => buildToolShortcutMap(), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTextInputFocused()) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && !e.shiftKey && key === 'z') { e.preventDefault(); onUndo(); return; }
      if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) { e.preventDefault(); onRedo(); return; }
      if (mod && key === 'n') { e.preventDefault(); onNewCanvas(); return; }
      if (mod && key === 'j') { e.preventDefault(); onDuplicateActiveLayer(); return; }
      if (mod && key === '0') { e.preventDefault(); onZoomFit(); return; }
      if (mod && key === '1') { e.preventDefault(); onZoom100(); return; }
      if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) { onDeleteActiveLayer(); return; }

      if (!mod && !e.altKey && toolMap[key]) { onToolChange(toolMap[key]); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toolMap, onToolChange, onUndo, onRedo, onNewCanvas, onDuplicateActiveLayer, onDeleteActiveLayer, onZoomFit, onZoom100]);
}
