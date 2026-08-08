/** Small, shared dock-panel control primitives — colocated once here instead of duplicated between
 *  `AdjustmentPanel.tsx` and `BlendingOptionsDialog.tsx`, which both need the exact same compact
 *  slider/checkbox/color-swatch/channel-tab-row shapes. */

import { useEffect, useRef, useState } from 'react';

export function Slider({ label, min, max, step = 1, value, onChange }: {
  label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void;
}) {
  // `onChange` typically flows straight into a full layer-tree state update (e.g. adjustment
  // layers, StudioCanvas.tsx's filter pipeline), which is too heavy to run on every single
  // pointermove tick of a drag. The readout (`display`) still updates every tick for a responsive
  // feel; the real `onChange` call is coalesced to at most once per animation frame, with the
  // exact final value always flushed synchronously on release so nothing is ever lost between frames.
  const [display, setDisplay] = useState(value);
  useEffect(() => setDisplay(value), [value]);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<number | null>(null);

  function flushPending() {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (pendingRef.current != null) { onChange(pendingRef.current); pendingRef.current = null; }
  }

  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  return (
    <label className="flex items-center gap-2 text-micro text-ink-faint">
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={display}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDisplay(v);
          pendingRef.current = v;
          if (rafRef.current == null) {
            rafRef.current = requestAnimationFrame(() => {
              rafRef.current = null;
              if (pendingRef.current != null) { onChange(pendingRef.current); pendingRef.current = null; }
            });
          }
        }}
        onPointerUp={flushPending}
        onBlur={flushPending}
        className="flex-1 accent-[var(--color-accent)]"
      />
      <span className="w-12 text-right tabular-nums">{display}</span>
    </label>
  );
}

export function CheckboxRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-micro text-ink-faint">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-micro text-ink-faint">
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 h-7 rounded-control border border-hairline bg-transparent"
      />
    </label>
  );
}

/** Small pill-button row — shared by Curves/Hue-Saturation/Levels' channel selectors (and the
 *  Blending Options dialog's own small enum choices), matching this app's compact-control
 *  convention rather than a full `<select>` for a short, frequently switched list. */
export function ChannelTabs<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`px-2 py-1 rounded-control text-micro border transition-colors ${
            value === o.id ? 'bg-accent-soft border-accent/30 text-accent' : 'bg-transparent border-hairline text-ink-faint hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
