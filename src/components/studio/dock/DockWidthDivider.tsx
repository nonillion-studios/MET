import { useRef } from 'react';

interface DockWidthDividerProps {
  onResize: (delta: number) => void;
}

export function DockWidthDivider({ onResize }: DockWidthDividerProps) {
  const dragging = useRef(false);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    let lastX = e.clientX;
    const onMove = (ev: PointerEvent) => {
      const delta = lastX - ev.clientX;
      lastX = ev.clientX;
      if (delta !== 0) onResize(delta);
    };
    const onUp = () => {
      dragging.current = false;
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
      aria-label="Resize dock width"
      className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-accent/40 active:bg-accent/60 transition-colors"
    />
  );
}
