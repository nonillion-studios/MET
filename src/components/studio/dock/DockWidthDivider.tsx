import { usePanelLayout } from './PanelLayoutContext';

/**
 * A 4px `col-resize` handle on the dock's left edge — same incremental-delta pointer-capture
 * technique as `PanelStack.tsx`'s `ResizeDivider` (drag deltas call `resizeDockWidth` live on every
 * pointermove, not a start/end diff), just horizontal and driving the whole dock's width instead
 * of one panel's height. Clamping to [MIN_DOCK_WIDTH, MAX_DOCK_WIDTH] happens inside
 * `resizeDockWidth` itself (applied against the latest state, not this component's own possibly
 * stale `layout.dockWidth` read), so a fast drag past either limit simply stops growing/shrinking.
 */
export function DockWidthDivider({ className }: { className?: string }) {
  const layout = usePanelLayout();

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    let lastX = e.clientX;
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - lastX;
      lastX = ev.clientX;
      // The divider sits on the dock's left edge — dragging left (negative delta) grows the dock.
      if (delta !== 0) layout.resizeDockWidth(-delta);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <div
      onPointerDown={handlePointerDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize right dock"
      className={`w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-accent/40 active:bg-accent/60 transition-colors ${className ?? ''}`}
    />
  );
}
