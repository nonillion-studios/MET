import { useState } from 'react';
import { Modal, Button, Switch } from '../ui';
import { BLEND_MODES, type BlendMode } from './studioTypes';

export interface FillPathResult {
  color: string;
  blendMode: BlendMode;
  opacity: number; // 0-1
  preserveTransparency: boolean;
}

type FillType = 'foreground' | 'background' | 'color' | 'black' | 'gray' | 'white';

const FILL_TYPE_OPTIONS: { id: FillType; label: string }[] = [
  { id: 'foreground', label: 'Foreground Color' },
  { id: 'background', label: 'Background Color' },
  { id: 'color', label: 'Color…' },
  { id: 'black', label: 'Black' },
  { id: 'gray', label: '50% Gray' },
  { id: 'white', label: 'White' },
];

interface FillPathDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (result: FillPathResult) => void;
  foregroundColor: string;
  backgroundColor: string;
}

/**
 * Fill Path stopped baking immediately with whatever the current tool color happened to be —
 * this asks first, matching Photoshop's own Fill Path dialog. Pattern/History fill types have no
 * backing infrastructure anywhere in this app (no pattern asset library, no addressable history
 * states beyond the linear undo stack) — shown disabled with a reason, this codebase's established
 * convention for a genuinely unavailable option, rather than a fake, non-functional entry.
 */
export function FillPathDialog({ open, onClose, onConfirm, foregroundColor, backgroundColor }: FillPathDialogProps) {
  const [fillType, setFillType] = useState<FillType>('foreground');
  const [customColor, setCustomColor] = useState('#000000');
  const [blendMode, setBlendMode] = useState<BlendMode>('normal');
  const [opacity, setOpacity] = useState(100);
  const [preserveTransparency, setPreserveTransparency] = useState(false);

  function resolveColor(): string {
    switch (fillType) {
      case 'foreground': return foregroundColor;
      case 'background': return backgroundColor;
      case 'color': return customColor;
      case 'black': return '#000000';
      case 'gray': return '#808080';
      case 'white': return '#ffffff';
    }
  }

  function handleOk() {
    onConfirm({ color: resolveColor(), blendMode, opacity: opacity / 100, preserveTransparency });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Fill Path"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleOk}>OK</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-micro text-ink-faint">
          <span>Fill</span>
          <select
            value={fillType}
            onChange={(e) => setFillType(e.target.value as FillType)}
            className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
          >
            {FILL_TYPE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            <option value="pattern" disabled>Pattern (unavailable)</option>
            <option value="history" disabled>History (unavailable)</option>
          </select>
        </label>

        {fillType === 'color' && (
          <label className="flex items-center gap-2 text-micro text-ink-faint">
            <span className="w-16 shrink-0">Color</span>
            <input
              type="color"
              value={customColor}
              onChange={(e) => setCustomColor(e.target.value)}
              className="flex-1 h-8 rounded-control border border-hairline bg-transparent"
            />
          </label>
        )}

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

        <label className="flex items-center justify-between text-micro text-ink-faint">
          <span>Preserve Transparency</span>
          <Switch checked={preserveTransparency} onChange={setPreserveTransparency} aria-label="Preserve Transparency" />
        </label>
      </div>
    </Modal>
  );
}
