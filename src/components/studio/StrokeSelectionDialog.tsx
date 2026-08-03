import { useState } from 'react';
import { Modal, Button } from '../ui';
import { BLEND_MODES, type BlendMode } from './studioTypes';

export interface StrokeSelectionResult {
  size: number; // px
  position: 'outside' | 'inside' | 'center';
  color: string;
  blendMode: BlendMode;
  opacity: number; // 0-1
}

interface StrokeSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (result: StrokeSelectionResult) => void;
  foregroundColor: string;
}

/** Marquee context menu > Stroke… — Photoshop's classic Stroke dialog (width, color, position,
 *  blend mode, opacity), distinct from `StrokePathDialog` (which replays real brush dynamics along
 *  a vector path's own anchors rather than drawing a flat dilate/erode ring around a selection). */
export function StrokeSelectionDialog({ open, onClose, onConfirm, foregroundColor }: StrokeSelectionDialogProps) {
  const [size, setSize] = useState(3);
  const [position, setPosition] = useState<'outside' | 'inside' | 'center'>('outside');
  const [color, setColor] = useState(foregroundColor);
  const [blendMode, setBlendMode] = useState<BlendMode>('normal');
  const [opacity, setOpacity] = useState(100);

  function handleOk() {
    onConfirm({ size, position, color, blendMode, opacity: opacity / 100 });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Stroke"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleOk}>OK</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-16 shrink-0">Width</span>
          <input
            type="number" min={1} max={250} value={size}
            onChange={(e) => setSize(Math.max(1, Number(e.target.value) || 1))}
            className="w-20 bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
          />
          <span>px</span>
        </label>

        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-16 shrink-0">Color</span>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="flex-1 h-8 rounded-control border border-hairline bg-transparent"
          />
        </label>

        <div className="flex flex-col gap-1 text-micro text-ink-faint">
          <span>Location</span>
          <div className="flex gap-1">
            {(['inside', 'center', 'outside'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPosition(p)}
                className={`flex-1 capitalize px-2 py-1.5 rounded-control border text-micro ${
                  position === p ? 'bg-accent-soft text-accent border-accent/40' : 'border-hairline text-ink hover:bg-ink/5'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1 text-micro text-ink-faint">
          <span>Blending Mode</span>
          <select
            value={blendMode}
            onChange={(e) => setBlendMode(e.target.value as BlendMode)}
            className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
          >
            {BLEND_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-16 shrink-0">Opacity</span>
          <input
            type="range" min={0} max={100} value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="flex-1 accent-[var(--color-accent)]"
          />
          <span className="w-10 text-right tabular-nums">{opacity}%</span>
        </label>
      </div>
    </Modal>
  );
}
