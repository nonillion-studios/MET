import { useEffect, useRef } from 'react';
import { BrushesPanel } from './BrushesPanel';
import type { BrushPreset } from '../../lib/brushStore';

interface BrushPickerPopoverProps {
  /** Where the right-click that opened this landed, in viewport (clientX/clientY) coordinates. */
  position: { x: number; y: number };
  onClose: () => void;
  color: string;
  activeBrushId: string | null;
  onSelectBrush: (preset: BrushPreset, mask?: HTMLCanvasElement) => void;
  live: {
    size: number; hardness: number; opacity: number; flow: number;
    spacing: number; angle: number; roundness: number; scatter: number; smoothing: number;
    pressureSize: boolean; pressureOpacity: boolean;
  };
  onLiveChange: (patch: Partial<BrushPickerPopoverProps['live']>) => void;
}

const PICKER_WIDTH = 280;
const PICKER_HEIGHT = 360;

/**
 * Compact floating brush picker opened by right-clicking the canvas while a paint tool (brush,
 * eraser, pencil) is active — same brush data/engine as the docked Brushes panel, just rendered at
 * the cursor instead of in the right-column dock. Selecting a preset applies it and closes the
 * popover immediately so the user can keep painting without switching focus back to the dock.
 */
export function BrushPickerPopover({ position, onClose, color, activeBrushId, onSelectBrush, live, onLiveChange }: BrushPickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(position.x, window.innerWidth - PICKER_WIDTH - 8));
  const top = Math.max(8, Math.min(position.y, window.innerHeight - PICKER_HEIGHT - 8));

  return (
    <div
      ref={ref}
      className="liquid-glass-bar fixed z-50 rounded-2xl border border-hairline shadow-lg"
      style={{ left, top, width: PICKER_WIDTH, height: PICKER_HEIGHT }}
    >
      <BrushesPanel
        color={color}
        activeBrushId={activeBrushId}
        onSelectBrush={(preset, mask) => { onSelectBrush(preset, mask); onClose(); }}
        live={live}
        onLiveChange={onLiveChange}
        hideTitle
      />
    </div>
  );
}
