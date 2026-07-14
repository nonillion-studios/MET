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
}

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

export function useStudioShortcuts({ onToolChange, onBrushSizeStep, onSwapColors, onResetColors, onZoomIn, onZoomOut, onFit, onToggleCleaned }: UseStudioShortcutsArgs) {
  const toolMap = useMemo(() => buildToolShortcutMap(), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTextInputFocused()) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod) {
        if (key === '=' || key === '+') { e.preventDefault(); onZoomIn(); return; }
        if (key === '-') { e.preventDefault(); onZoomOut(); return; }
        if (key === '0') { e.preventDefault(); onFit(); return; }
        return; // other mod combos (undo/redo) are handled by useKeyboardUndo
      }

      if (key === '[') { onBrushSizeStep(-2); return; }
      if (key === ']') { onBrushSizeStep(2); return; }
      if (key === 'x') { onSwapColors(); return; }
      if (key === 'd') { onResetColors(); return; }
      if (key === 'o') { onToggleCleaned(); return; }

      const toolId = toolMap[key];
      if (toolId) { e.preventDefault(); onToolChange(toolId); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toolMap, onToolChange, onBrushSizeStep, onSwapColors, onResetColors, onZoomIn, onZoomOut, onFit, onToggleCleaned]);
}
