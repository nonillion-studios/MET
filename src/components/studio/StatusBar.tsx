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

/** A slim, always-present bar at the very bottom of the Studio shell — zoom/cursor/image-size/
 *  tool/layer, all driven by state `Studio.tsx` already tracks or mirrors from `StudioCanvas` via
 *  its `onViewportChange`/`onCursorImagePosChange` callbacks (see StudioCanvas.tsx). Never owns any
 *  of this data itself. */
export function StatusBar({ zoom, onZoomClick, cursorPos, imageWidth, imageHeight, toolLabel, layerName }: StatusBarProps) {
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
      <span className="truncate">{layerName ?? 'No Layer'}</span>
    </div>
  );
}
