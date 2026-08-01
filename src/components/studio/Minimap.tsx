import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const MAX_WIDTH = 200;
const MAX_HEIGHT = 150;

interface MinimapProps {
  /** The page's own background image data URL (`page.original.dataUrl` or `page.cleaned.dataUrl`,
   *  whichever `showCleaned` currently displays) — loaded independently here rather than sharing
   *  `StudioCanvas`'s own internal `image` state, so this panel stays fully decoupled from the
   *  canvas engine's internals. */
  imageDataUrl: string | null;
  pageWidth: number;
  pageHeight: number;
  viewportPos: { x: number; y: number };
  viewportScale: number;
  containerWidth: number;
  containerHeight: number;
  onPan: (imageX: number, imageY: number) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * Bottom-right panel showing the current page at thumbnail scale with a viewport rectangle. Shows
 * the page's background art (whichever of original/cleaned is on screen) — redraws whenever
 * `imageDataUrl` changes (page switch, or toggling View Original). Does **not** show painted layer
 * content on top — a deliberate scope decision (a live per-layer flatten composited on every brush
 * stroke would cost far more than this panel's job justifies); see CLAUDE.md for the honest
 * limitation.
 */
export function Minimap({
  imageDataUrl, pageWidth, pageHeight, viewportPos, viewportScale, containerWidth, containerHeight,
  onPan, collapsed, onToggleCollapsed,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  const fitScale = pageWidth > 0 && pageHeight > 0
    ? Math.min(MAX_WIDTH / pageWidth, MAX_HEIGHT / pageHeight)
    : 1;
  const mapWidth = Math.max(1, Math.round(pageWidth * fitScale));
  const mapHeight = Math.max(1, Math.round(pageHeight * fitScale));

  useEffect(() => {
    if (!imageDataUrl) { setImage(null); return; }
    const img = new window.Image();
    img.src = imageDataUrl;
    img.onload = () => setImage(img);
    return () => { img.onload = null; };
  }, [imageDataUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || collapsed) return;
    canvas.width = mapWidth;
    canvas.height = mapHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, mapWidth, mapHeight);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, mapWidth, mapHeight);
    if (image) ctx.drawImage(image, 0, 0, mapWidth, mapHeight);
  }, [image, mapWidth, mapHeight, collapsed]);

  if (collapsed) {
    return (
      <div className="absolute bottom-2 right-2 z-20 liquid-glass-heavy rounded-lg border border-hairline shadow-lg">
        <button
          type="button"
          aria-label="Expand minimap"
          title="Expand minimap"
          onClick={onToggleCollapsed}
          className="studio-interactive studio-focusable flex items-center gap-1 px-2 py-1 text-micro text-ink-faint"
        >
          <ChevronUp size={12} /> Minimap
        </button>
      </div>
    );
  }

  const panFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    onPan(mx / fitScale, my / fitScale);
  };

  // Viewport rectangle, in minimap-local pixels: the visible page-space region is derived from the
  // main canvas's own pos/scale (screenX = pos.x + imageX*scale), then scaled down by fitScale.
  const viewX = (-viewportPos.x / viewportScale) * fitScale;
  const viewY = (-viewportPos.y / viewportScale) * fitScale;
  const viewW = (containerWidth / viewportScale) * fitScale;
  const viewH = (containerHeight / viewportScale) * fitScale;

  return (
    <div className="absolute bottom-2 right-2 z-20 liquid-glass-heavy rounded-lg border border-hairline shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-2 py-0.5 border-b border-hairline">
        <span className="text-micro text-ink-faint">Minimap</span>
        <button
          type="button"
          aria-label="Collapse minimap"
          title="Collapse minimap"
          onClick={onToggleCollapsed}
          className="studio-interactive studio-focusable text-ink-faint"
        >
          <ChevronDown size={12} />
        </button>
      </div>
      <div
        className="relative"
        style={{ width: mapWidth, height: mapHeight, cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: mapWidth, height: mapHeight, display: 'block' }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            panFromEvent(e);
          }}
          onPointerMove={(e) => { if (dragging) panFromEvent(e); }}
          onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); }}
        />
        <div
          className="absolute border-2 border-white/90 bg-white/10 pointer-events-none"
          style={{
            left: Math.max(0, viewX),
            top: Math.max(0, viewY),
            width: Math.min(mapWidth, viewX + viewW) - Math.max(0, viewX),
            height: Math.min(mapHeight, viewY + viewH) - Math.max(0, viewY),
          }}
        />
      </div>
    </div>
  );
}
