import { StudioPanel } from './StudioPanel';
import type { AdjustmentKind, AdjustmentLayerData, StudioLayer } from './studioTypes';

interface AdjustmentPanelProps {
  layer: StudioLayer;
  onUpdate: (id: string, patch: Partial<AdjustmentLayerData>) => void;
}

const KIND_LABELS: Record<AdjustmentKind, string> = {
  'brightness-contrast': 'Brightness/Contrast',
  'hue-saturation': 'Hue/Saturation',
  levels: 'Levels',
};

function Slider({ label, min, max, step = 1, value, onChange }: {
  label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-micro text-ink-faint">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[var(--color-accent)]"
      />
      <span className="w-10 text-right tabular-nums">{value}</span>
    </label>
  );
}

export function AdjustmentPanel({ layer, onUpdate }: AdjustmentPanelProps) {
  const data = layer.adjustment;
  if (!data) return null;

  const set = (patch: Partial<AdjustmentLayerData>) => onUpdate(layer.id, patch);
  const setLevels = (patch: Partial<AdjustmentLayerData['levels']>) => set({ levels: { ...data.levels, ...patch } });

  return (
    <StudioPanel title="Adjustment">
        <p className="text-micro text-ink-faint/70 leading-snug">
          Applies to every layer below this one. Move it up or down the stack to change what it affects,
          or lower its opacity to ease it off.
        </p>

        <label className="flex flex-col gap-1 text-micro text-ink-faint">
          <span>Type</span>
          <select
            value={data.kind}
            onChange={(e) => set({ kind: e.target.value as AdjustmentKind })}
            className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
          >
            {(Object.keys(KIND_LABELS) as AdjustmentKind[]).map(k => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
        </label>

        {data.kind === 'brightness-contrast' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Brightness" min={-100} max={100} value={data.brightness} onChange={(v) => set({ brightness: v })} />
            <Slider label="Contrast" min={-100} max={100} value={data.contrast} onChange={(v) => set({ contrast: v })} />
          </div>
        )}

        {data.kind === 'hue-saturation' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Hue" min={-180} max={180} value={data.hue} onChange={(v) => set({ hue: v })} />
            <Slider label="Saturation" min={-100} max={100} value={data.saturation} onChange={(v) => set({ saturation: v })} />
            <Slider label="Lightness" min={-100} max={100} value={data.lightness} onChange={(v) => set({ lightness: v })} />
          </div>
        )}

        {data.kind === 'levels' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="In black" min={0} max={254} value={data.levels.inBlack} onChange={(v) => setLevels({ inBlack: Math.min(v, data.levels.inWhite - 1) })} />
            <Slider label="In white" min={1} max={255} value={data.levels.inWhite} onChange={(v) => setLevels({ inWhite: Math.max(v, data.levels.inBlack + 1) })} />
            <Slider label="Gamma" min={0.1} max={9.99} step={0.01} value={data.levels.gamma} onChange={(v) => setLevels({ gamma: v })} />
            <Slider label="Out black" min={0} max={254} value={data.levels.outBlack} onChange={(v) => setLevels({ outBlack: Math.min(v, data.levels.outWhite - 1) })} />
            <Slider label="Out white" min={1} max={255} value={data.levels.outWhite} onChange={(v) => setLevels({ outWhite: Math.max(v, data.levels.outBlack + 1) })} />
          </div>
        )}
    </StudioPanel>
  );
}
