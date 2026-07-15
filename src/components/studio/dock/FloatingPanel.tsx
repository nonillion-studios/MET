import { useCallback, useRef, type ReactNode } from 'react';
import { X, PanelRightClose } from 'lucide-react';
import { IconButton } from '../../ui';
import type { FloatingRect } from './DockContext';

interface FloatingPanelProps {
  label: string;
  rect: FloatingRect;
  onRectChange: (rect: FloatingRect) => void;
  onDockBack: () => void;
  children: ReactNode;
}

const MIN_WIDTH = 220;
const MIN_HEIGHT = 180;

export function FloatingPanel({ label, rect, onRectChange, onDockBack, children }: FloatingPanelProps) {
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const origin = { ...rectRef.current };
    function onMove(ev: PointerEvent) {
      onRectChange({ ...rectRef.current, x: origin.x + (ev.clientX - startX), y: origin.y + (ev.clientY - startY) });
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [onRectChange]);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const origin = { ...rectRef.current };
    function onMove(ev: PointerEvent) {
      onRectChange({
        ...rectRef.current,
        width: Math.max(MIN_WIDTH, origin.width + (ev.clientX - startX)),
        height: Math.max(MIN_HEIGHT, origin.height + (ev.clientY - startY)),
      });
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [onRectChange]);

  return (
    <div
      className="fixed z-40 studio-panel-floating flex flex-col overflow-hidden"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <div
        onPointerDown={startDrag}
        className="flex items-center justify-between h-9 px-3 shrink-0 border-b border-hairline cursor-move select-none"
      >
        <span className="text-ui font-display font-semibold text-ink-faint uppercase tracking-wide">{label}</span>
        <div className="flex items-center gap-1">
          <IconButton size="sm" aria-label="Dock back" title="Dock back" onClick={onDockBack} className="!bg-transparent !w-6 !h-6">
            <PanelRightClose size={12} />
          </IconButton>
          <IconButton size="sm" aria-label="Close" onClick={onDockBack} className="!bg-transparent !w-6 !h-6">
            <X size={12} />
          </IconButton>
        </div>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
      <div
        onPointerDown={startResize}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
        style={{ background: 'linear-gradient(135deg, transparent 50%, var(--color-hairline) 50%)' }}
      />
    </div>
  );
}
