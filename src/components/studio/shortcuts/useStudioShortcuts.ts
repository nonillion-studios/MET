import { useEffect, useMemo } from 'react';
import { buildToolShortcutMap } from './shortcutsMap';

interface UseStudioShortcutsArgs {
  onToolChange: (id: string) => void;
  onBrushSizeStep: (delta: number) => void;
  onSwapColors: () => void;
  onResetColors: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onToggleCleaned: () => void;
  onToggleFullscreen: () => void;
  onTogglePanelsHidden: () => void;
  onExport: () => void;
  onGroupLayers: () => void;
  onUngroupLayers: () => void;
  onToggleQuickMask: () => void;
  /** TypeR-style size-increment-with-recenter for the active text layer. delta is +1/-1. */
  onTextSizeStep: (delta: number) => void;
}

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

export function useStudioShortcuts({
  onToolChange, onBrushSizeStep, onSwapColors, onResetColors, onZoomIn, onZoomOut, onFit,
  onToggleCleaned, onToggleFullscreen, onTogglePanelsHidden, onExport, onGroupLayers, onUngroupLayers,
  onToggleQuickMask, onTextSizeStep,
}: UseStudioShortcutsArgs) {
  const toolMap = useMemo(() => buildToolShortcutMap(), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTextInputFocused()) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Not a literal "F11" binding — browsers intercept F11 at the chrome level before
      // JS reliably sees it, so Ctrl/Cmd+Shift+F is the in-app fullscreen shortcut instead.
      if (mod && e.shiftKey && key === 'f') { e.preventDefault(); onToggleFullscreen(); return; }
      // Checked ahead of plain Ctrl+G below, or the ungroup combo would be swallowed by grouping.
      if (mod && e.shiftKey && key === 'g') { e.preventDefault(); onUngroupLayers(); return; }

      if (mod) {
        if (key === 'g') { e.preventDefault(); onGroupLayers(); return; }
        if (key === '=' || key === '+') { e.preventDefault(); onZoomIn(); return; }
        if (key === '-') { e.preventDefault(); onZoomOut(); return; }
        if (key === '0') { e.preventDefault(); onFit(); return; }
        if (key === 'e') { e.preventDefault(); onExport(); return; }
        // "." / "," rather than "]" / "[" — those are already the brush-size-step keys.
        if (key === '.') { e.preventDefault(); onTextSizeStep(1); return; }
        if (key === ',') { e.preventDefault(); onTextSizeStep(-1); return; }
        return; // other mod combos (undo/redo) are handled by useKeyboardUndo
      }

      if (e.key === 'Tab') { e.preventDefault(); onTogglePanelsHidden(); return; }

      if (key === '[') { onBrushSizeStep(-2); return; }
      if (key === ']') { onBrushSizeStep(2); return; }
      if (key === 'x') { onSwapColors(); return; }
      if (key === 'd') { onResetColors(); return; }
      if (key === 'o') { onToggleCleaned(); return; }
      if (key === 'q') { onToggleQuickMask(); return; }

      const toolId = toolMap[key];
      if (toolId) { e.preventDefault(); onToolChange(toolId); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toolMap, onToolChange, onBrushSizeStep, onSwapColors, onResetColors, onZoomIn, onZoomOut, onFit, onToggleCleaned, onToggleFullscreen, onTogglePanelsHidden, onExport, onToggleQuickMask, onTextSizeStep]);
}
