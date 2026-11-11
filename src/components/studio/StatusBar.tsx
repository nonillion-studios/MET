import { useEffect, useState } from 'react';

function useMemoryUsage(): string | null {
  const [mem, setMem] = useState<string | null>(null);
  useEffect(() => {
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };
    if (!perf.memory) return;
    function update() {
      const m = (performance as typeof perf).memory!;
      const usedMB = Math.round(m.usedJSHeapSize / (1024 * 1024));
      const limitMB = Math.round(m.jsHeapSizeLimit / (1024 * 1024));
      setMem(`${usedMB}/${limitMB} MB`);
    }
    update();
    const id = setInterval(update, 5000);
    return () => clearInterval(id);
  }, []);
  return mem;
}

interface StatusBarProps {
  /** 1 = 100%. */
  zoom: number;
  onZoomClick: () => void;
  cursorPos: { x: number; y: number } | null;
  imageWidth: number | null;
  imageHeight: number | null;
  toolLabel: string;
  layerName: string | null;
}

export function StatusBar({ zoom, onZoomClick, cursorPos, imageWidth, imageHeight, toolLabel, layerName }: StatusBarProps) {
  const mem = useMemoryUsage();

  return (
    <div className="h-6 shrink-0 flex items-center gap-4 px-3 liquid-glass-bar border-t border-hairline text-micro text-ink-faint select-none">
      <button
        type="button"
        onClick={onZoomClick}
        className="studio-interactive studio-focusable tabular-nums hover:text-ink shrink-0"
        title="Click to set zoom"
      >
        {Math.round(zoom * 100)}%
      </button>
      <span className="tabular-nums shrink-0 w-28">
        {cursorPos ? `X: ${Math.round(cursorPos.x)}, Y: ${Math.round(cursorPos.y)}` : 'X: —, Y: —'}
      </span>
      <span className="tabular-nums shrink-0">
        {imageWidth != null && imageHeight != null ? `${imageWidth} × ${imageHeight} px` : '— × — px'}
      </span>
      <span className="shrink-0">{toolLabel}</span>
      <span className="truncate flex-1">{layerName ?? 'No Layer'}</span>
      {mem && <span className="tabular-nums shrink-0 text-ink-faint/60" title="JS heap usage">{mem}</span>}
    </div>
  );
}
