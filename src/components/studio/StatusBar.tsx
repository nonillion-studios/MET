import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';

const ZOOM_PRESETS = [0.25, 0.5, 1, 2, 4, 8];

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
  onZoomChange: (zoom: number) => void;
  onFitToScreen?: () => void;
  cursorPos: { x: number; y: number } | null;
  imageWidth: number | null;
  imageHeight: number | null;
  toolLabel: string;
  layerName: string | null;
  selectionBounds?: { x: number; y: number; width: number; height: number } | null;
  snapToGrid?: boolean;
  snapToGuides?: boolean;
}

export function StatusBar({ zoom, onZoomChange, onFitToScreen, cursorPos, imageWidth, imageHeight, toolLabel, layerName, selectionBounds, snapToGrid, snapToGuides }: StatusBarProps) {
  const mem = useMemoryUsage();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setEditValue(String(Math.round(zoom * 100)));
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  }

  function commitEdit() {
    setEditing(false);
    const percent = Number(editValue);
    if (Number.isFinite(percent) && percent > 0) onZoomChange(percent / 100);
  }

  return (
    <div className="h-6 shrink-0 flex items-center gap-4 px-3 liquid-glass-bar border-t border-hairline text-micro text-ink-faint select-none">
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" title="Zoom out" onClick={() => { const next = ZOOM_PRESETS.slice().reverse().find(z => z < zoom - 0.01); if (next) onZoomChange(next); }} className="w-4 h-4 flex items-center justify-center hover:text-ink"><ZoomOut size={12} /></button>
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
            className="w-14 bg-ink/10 border border-accent rounded px-1 text-ink text-micro tabular-nums outline-none"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="studio-interactive studio-focusable tabular-nums hover:text-ink shrink-0"
            title="Click to set zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
        )}
        <button type="button" title="Zoom in" onClick={() => { const next = ZOOM_PRESETS.find(z => z > zoom + 0.01); if (next) onZoomChange(next); }} className="w-4 h-4 flex items-center justify-center hover:text-ink"><ZoomIn size={12} /></button>
        {onFitToScreen && <button type="button" title="Fit to screen (Ctrl+0)" onClick={onFitToScreen} className="w-4 h-4 flex items-center justify-center hover:text-ink"><Maximize size={11} /></button>}
      </div>
      <span className="tabular-nums shrink-0 w-28">
        {cursorPos ? `X: ${Math.round(cursorPos.x)}, Y: ${Math.round(cursorPos.y)}` : 'X: —, Y: —'}
      </span>
      <span className="tabular-nums shrink-0">
        {imageWidth != null && imageHeight != null ? `${imageWidth} × ${imageHeight} px` : '— × — px'}
      </span>
      <span className="shrink-0">{toolLabel}</span>
      {selectionBounds && selectionBounds.width > 0 && selectionBounds.height > 0 && (
        <span className="tabular-nums shrink-0 text-accent">
          Sel: {Math.round(selectionBounds.width)} x {Math.round(selectionBounds.height)}
        </span>
      )}
      {snapToGrid && <span className="shrink-0 text-accent/70">SNAP</span>}
      {snapToGuides && <span className="shrink-0 text-accent/70">GUIDES</span>}
      <span className="truncate flex-1">{layerName ?? 'No Layer'}</span>
      {mem && <span className="tabular-nums shrink-0 text-ink-faint/60" title="JS heap usage">{mem}</span>}
    </div>
  );
}
