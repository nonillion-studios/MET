/** Small, shared dock-panel control primitives — colocated once here instead of duplicated between
 *  `AdjustmentPanel.tsx` and `BlendingOptionsDialog.tsx`, which both need the exact same compact
 *  slider/checkbox/color-swatch/channel-tab-row shapes. */

export function Slider({ label, min, max, step = 1, value, onChange }: {
  label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-micro text-ink-faint">
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[var(--color-accent)]"
      />
      <span className="w-12 text-right tabular-nums">{value}</span>
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
