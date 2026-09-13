import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button, GlassCard, IconButton } from '../ui';
import { useFullscreenPortalTarget } from '../../lib/useFullscreenPortalTarget';
import { createDefaultWarpSettings, type WarpStyle, type WarpTextSettings } from './studioTypes';
import { meshFromStyle } from '../../lib/textWarp';

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

/**
 * Text menu / options-bar warp button / right-click "Warp Text…" — all three open this same panel.
 * Settings live on the text layer itself (`TextLayerData.warp`), not baked into an image, so the
 * text stays fully editable after warping — see textWarpRender.ts.
 *
 * A non-blocking, corner-docked panel (not a `Modal`) rather than a centered backdrop dialog — the
 * canvas (and, while a layer is selected, its on-canvas warp mesh handles, see
 * TextWarpMeshOverlay.tsx) needs to stay visible and interactive while this is open, since dragging
 * a mesh handle and adjusting a field here are two entry points onto the exact same warp state, not
 * mutually exclusive modes.
 */
export function WarpTextDialog({ open, initial, onClose, onPreview, onConfirm, onCancel }: WarpTextDialogProps) {
  const [warp, setWarp] = useState<WarpTextSettings>(() => initial ?? createDefaultWarpSettings());
  const portalTarget = useFullscreenPortalTarget();

  useEffect(() => {
    if (open) setWarp(initial ?? createDefaultWarpSettings());
  }, [open, initial]);

  /** Every field here regenerates `mesh` from scratch (when there's a real style to generate one
   *  from) rather than leaving a stale mesh in place — once a mesh exists it's the sole render
   *  source (see WarpTextSettings.mesh's own doc comment), so leaving it untouched while the style/
   *  bend/H/V fields kept changing would make those fields visually no-op after the user's first
   *  mesh drag, which "every control must be real" doesn't allow. Matches Photoshop's own behavior:
   *  picking a new preset (or adjusting its numeric fields) resets any custom mesh edits. */
  function patch(next: Partial<WarpTextSettings>) {
    const merged = { ...warp, ...next };
    const mesh = merged.style !== 'none'
      ? meshFromStyle(merged.style, merged.bend, merged.horizontalDistortion, merged.verticalDistortion, merged.orientation)
      : undefined;
    const final = { ...merged, mesh };
    setWarp(final);
    onPreview(final);
  }

  function handleOk() {
    onConfirm(warp);
    onClose();
  }

  function handleCancel() {
    onCancel(initial);
    onClose();
  }

  if (!open) return null;

  return createPortal(
    <div className="fixed bottom-4 right-4 z-40 pointer-events-none flex justify-end">
      <GlassCard
        variant="heavy"
        radius="2xl"
        className="pointer-events-auto w-72 max-h-[70vh] flex flex-col overflow-hidden shadow-2xl border border-hairline"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-hairline shrink-0">
          <h2 className="font-display text-sm font-semibold text-ink">Text Warp</h2>
          <IconButton aria-label="Close" size="sm" onClick={handleCancel}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="px-4 py-3 overflow-y-auto flex-1 min-h-0 flex flex-col gap-3">
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
        <div className="px-4 py-3 border-t border-hairline shrink-0 flex justify-end gap-2">
          <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleOk}>OK</Button>
        </div>
      </GlassCard>
    </div>,
    portalTarget,
  );
}
