import { useEffect, useRef } from 'react';
import { ADJUSTMENT_KIND_LABEL, ADJUSTMENT_KIND_ICON, type AdjustmentKind } from './studioTypes';

interface AdjustmentPickerPopoverProps {
  onPick: (kind: AdjustmentKind) => void;
  onClose: () => void;
}

const KINDS = Object.keys(ADJUSTMENT_KIND_LABEL) as AdjustmentKind[];

/**
 * Photoshop-style icon grid (3 per row) — replaces the old "Add adjustment layer" button always
 * defaulting to Brightness/Contrast. Native `title` tooltips (matching this app's existing
 * tool-rail-icon convention) rather than a custom tooltip component. Positioned `absolute` inside
 * the panel's own `relative` wrapper (not viewport-fixed like `ToolFlyout`) — this panel never sits
 * close enough to a screen edge for the simple below-right placement to clip in practice.
 */
export function AdjustmentPickerPopover({ onPick, onClose }: AdjustmentPickerPopoverProps) {
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

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 liquid-glass-heavy rounded-panel border border-hairline p-2 grid grid-cols-3 gap-1 w-48"
    >
      {KINDS.map((kind) => {
        const Icon = ADJUSTMENT_KIND_ICON[kind];
        return (
          <button
            key={kind}
            type="button"
            title={ADJUSTMENT_KIND_LABEL[kind]}
            aria-label={ADJUSTMENT_KIND_LABEL[kind]}
            onClick={() => { onPick(kind); onClose(); }}
            className="studio-interactive studio-focusable flex flex-col items-center justify-center gap-1 py-2 rounded-control text-ink hover:bg-ink/10"
          >
            <Icon size={17} strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
