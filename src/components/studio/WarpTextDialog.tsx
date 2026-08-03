import { useEffect, useState } from 'react';
import { Modal, Button } from '../ui';
import { createDefaultWarpSettings, type WarpStyle, type WarpTextSettings } from './studioTypes';

const WARP_STYLE_OPTIONS: { id: WarpStyle; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'arc', label: 'Arc' },
  { id: 'arcLower', label: 'Arc Lower' },
  { id: 'arcUpper', label: 'Arc Upper' },
  { id: 'arch', label: 'Arch' },
  { id: 'bulge', label: 'Bulge' },
  { id: 'shellLower', label: 'Shell Lower' },
  { id: 'shellUpper', label: 'Shell Upper' },
  { id: 'flag', label: 'Flag' },
  { id: 'wave', label: 'Wave' },
  { id: 'fish', label: 'Fish' },
  { id: 'rise', label: 'Rise' },
  { id: 'fisheye', label: 'Fisheye' },
  { id: 'inflate', label: 'Inflate' },
  { id: 'squeeze', label: 'Squeeze' },
  { id: 'twist', label: 'Twist' },
];

interface WarpTextDialogProps {
  open: boolean;
  initial?: WarpTextSettings;
  onClose: () => void;
  /** Fired on every field change (live preview — see Studio.tsx's `handlePreviewWarp`, which patches
   *  the text layer directly, same "live-update, revert on cancel" shape BlendingOptionsDialog uses). */
  onPreview: (warp: WarpTextSettings) => void;
  /** Fired once, on OK — the real committed, undoable change. */
  onConfirm: (warp: WarpTextSettings) => void;
  /** Fired on Cancel/close — restores whatever the layer's warp was before the dialog opened. */
  onCancel: (previous: WarpTextSettings | undefined) => void;
}

/** Text menu / options-bar warp button / right-click "Warp Text…" — all three open this same
 *  dialog. Settings live on the text layer itself (`TextLayerData.warp`), not baked into an image,
 *  so the text stays fully editable after warping — see textWarpRender.ts. */
export function WarpTextDialog({ open, initial, onClose, onPreview, onConfirm, onCancel }: WarpTextDialogProps) {
  const [warp, setWarp] = useState<WarpTextSettings>(() => initial ?? createDefaultWarpSettings());

  useEffect(() => {
    if (open) setWarp(initial ?? createDefaultWarpSettings());
  }, [open, initial]);

  function patch(next: Partial<WarpTextSettings>) {
    const merged = { ...warp, ...next };
    setWarp(merged);
    onPreview(merged);
  }

  function handleOk() {
    onConfirm(warp);
    onClose();
  }

  function handleCancel() {
    onCancel(initial);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title="Warp Text"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleOk}>OK</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-micro text-ink-faint">
          <span>Style</span>
          <select
            value={warp.style}
            onChange={(e) => patch({ style: e.target.value as WarpStyle })}
            className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
          >
            {WARP_STYLE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-micro text-ink-faint">
          <span>Orientation</span>
          <div className="flex gap-3">
            {(['horizontal', 'vertical'] as const).map((o) => (
              <label key={o} className="flex items-center gap-1.5 capitalize">
                <input
                  type="radio"
                  name="warp-orientation"
                  checked={warp.orientation === o}
                  onChange={() => patch({ orientation: o })}
                />
                {o}
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-32 shrink-0">Bend</span>
          <input
            type="range" min={-100} max={100} value={warp.bend}
            onChange={(e) => patch({ bend: Number(e.target.value) })}
            className="flex-1 accent-[var(--color-accent)]"
          />
          <span className="w-10 text-right tabular-nums">{warp.bend}</span>
        </label>

        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-32 shrink-0">Horizontal Distortion</span>
          <input
            type="range" min={-100} max={100} value={warp.horizontalDistortion}
            onChange={(e) => patch({ horizontalDistortion: Number(e.target.value) })}
            className="flex-1 accent-[var(--color-accent)]"
          />
          <span className="w-10 text-right tabular-nums">{warp.horizontalDistortion}</span>
        </label>

        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-32 shrink-0">Vertical Distortion</span>
          <input
            type="range" min={-100} max={100} value={warp.verticalDistortion}
            onChange={(e) => patch({ verticalDistortion: Number(e.target.value) })}
            className="flex-1 accent-[var(--color-accent)]"
          />
          <span className="w-10 text-right tabular-nums">{warp.verticalDistortion}</span>
        </label>
      </div>
    </Modal>
  );
}
