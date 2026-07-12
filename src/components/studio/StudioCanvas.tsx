import { useEffect, useRef, useState, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect } from 'react-konva';
import type Konva from 'konva';
import type { Page } from '../../types';
import { BLEND_TO_COMPOSITE, type StudioLayer } from './studioTypes';

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

interface StudioCanvasProps {
  page: Page | null;
  showCleaned: boolean;
  activeTool: string;
  /** Bumped by the parent (e.g. toolbar "Fit" button) to force a re-fit. */
  fitSignal: number;
  /** Non-background layers stacked above the page image, bottom to top. */
  layers: StudioLayer[];
}

export function StudioCanvas({ page, showCleaned, activeTool, fitSignal, layers }: StudioCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const pinchDistRef = useRef<number | null>(null);
  const [touchCount, setTouchCount] = useState(0);

  const activeSource = showCleaned && page?.cleaned ? page.cleaned : page?.original ?? null;

  // Load the active image element for Konva.
  useEffect(() => {
    if (!activeSource) { setImage(null); return; }
    const img = new window.Image();
    img.src = activeSource.dataUrl;
    img.onload = () => setImage(img);
    return () => { img.onload = null; };
  }, [activeSource]);

  // Track container size responsively.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitToScreen = useCallback(() => {
    if (!image || containerSize.width === 0 || containerSize.height === 0) return;
    const padding = 32;
    const scaleX = (containerSize.width - padding * 2) / image.width;
    const scaleY = (containerSize.height - padding * 2) / image.height;
    const next = Math.min(scaleX, scaleY, 1.5);
    setScale(next);
    setPos({
      x: (containerSize.width - image.width * next) / 2,
      y: (containerSize.height - image.height * next) / 2,
    });
  }, [image, containerSize]);

  useEffect(() => { fitToScreen(); }, [fitToScreen, page?.id, fitSignal]);

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const oldScale = scale;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const zoomFactor = 1.08;
    const newScale = clampScale(direction > 0 ? oldScale * zoomFactor : oldScale / zoomFactor);

    const mousePointTo = {
      x: (pointer.x - pos.x) / oldScale,
      y: (pointer.y - pos.y) / oldScale,
    };

    setScale(newScale);
    setPos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const handleTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    if (touches.length !== 2) return;
    e.evt.preventDefault();

    const [t1, t2] = [touches[0], touches[1]];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const center = {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    };
    const stage = stageRef.current;
    const box = containerRef.current?.getBoundingClientRect();
    if (!stage || !box) return;
    const stagePoint = { x: center.x - box.left, y: center.y - box.top };

    if (pinchDistRef.current == null) {
      pinchDistRef.current = dist;
      return;
    }

    const oldScale = scale;
    const newScale = clampScale(oldScale * (dist / pinchDistRef.current));
    pinchDistRef.current = dist;

    const stagePointTo = {
      x: (stagePoint.x - pos.x) / oldScale,
      y: (stagePoint.y - pos.y) / oldScale,
    };
    setScale(newScale);
    setPos({
      x: stagePoint.x - stagePointTo.x * newScale,
      y: stagePoint.y - stagePointTo.y * newScale,
    });
  };

  const handleTouchEnd = (e: Konva.KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length < 2) pinchDistRef.current = null;
    setTouchCount(e.evt.touches.length);
  };

  const draggable = activeTool === 'pan' || activeTool === 'select';

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-[#0b0b0d] touch-none">
      {containerSize.width > 0 && (
        <Stage
          ref={stageRef}
          width={containerSize.width}
          height={containerSize.height}
          scaleX={scale}
          scaleY={scale}
          x={pos.x}
          y={pos.y}
          draggable={draggable && touchCount < 2}
          onDragEnd={(e) => setPos({ x: e.target.x(), y: e.target.y() })}
          onWheel={handleWheel}
          onTouchMove={handleTouchMove}
          onTouchStart={(e) => setTouchCount(e.evt.touches.length)}
          onTouchEnd={handleTouchEnd}
        >
          <Layer>
            {image && (
              <>
                <Rect
                  x={-4}
                  y={-4}
                  width={image.width + 8}
                  height={image.height + 8}
                  fill="#000000"
                  shadowColor="black"
                  shadowBlur={20}
                  shadowOpacity={0.6}
                />
                <KonvaImage image={image} width={image.width} height={image.height} />
              </>
            )}
          </Layer>

          {/* Each Studio layer (clean patches, text, bubble masks...) gets its own Konva
              layer so opacity and blend mode compose independently of the background. */}
          {layers.filter(l => !l.isBackground).map(layer => (
            <Layer
              key={layer.id}
              visible={layer.visible}
              opacity={layer.opacity}
              globalCompositeOperation={BLEND_TO_COMPOSITE[layer.blendMode]}
              listening={layer.visible && !layer.locked}
            />
          ))}
        </Stage>
      )}
      {!page && (
        <div className="absolute inset-0 flex items-center justify-center text-white/40 text-sm">
          Select a page to begin
        </div>
      )}
      <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-lg liquid-glass text-[11px] font-mono text-white/80">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
}

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}
