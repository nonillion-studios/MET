interface DesignBrushOptionsBarProps {
  size: number;
  onSizeChange: (v: number) => void;
  color: string;
  onColorChange: (v: string) => void;
  hardness: number;
  onHardnessChange: (v: number) => void;
  opacity: number;
  onOpacityChange: (v: number) => void;
  flow: number;
  onFlowChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <label className="flex items-center gap-2 text-micro text-ink-faint shrink-0">
      <span className="uppercase tracking-wide text-[10px] opacity-70">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="studio-focusable accent-[var(--color-accent)] w-20"
      />
      <span className="w-8 text-right tabular-nums text-ink font-mono text-[10px]">{format ? format(value) : Math.round(value)}</span>
    </label>
  );
}

/**
 * Minimal brush options for Design Mode's brush/pencil/eraser tools — a small, bounded subset of
 * Studio's ~30-prop ToolOptionsBar (which is wired to Studio-only clone/heal/liquify/background-
 * eraser/magic-eraser/content-aware state this session doesn't add to Design Mode). Composes the
 * same PaintSettings fields Studio's own brush uses; only the UI chrome here is new.
 */
export function DesignBrushOptionsBar({
  size, onSizeChange, color, onColorChange, hardness, onHardnessChange, opacity, onOpacityChange, flow, onFlowChange,
}: DesignBrushOptionsBarProps) {
  return (
    <div className="liquid-glass-bar w-full h-10 shrink-0 border-b border-hairline px-3 flex items-center gap-4 z-10">
      <label className="flex items-center gap-2 text-micro text-ink-faint shrink-0">
        <span className="uppercase tracking-wide text-[10px] opacity-70">Color</span>
        <input
          type="color"
          value={color}
          onChange={(e) => onColorChange(e.target.value)}
          className="w-6 h-6 rounded border border-hairline bg-transparent cursor-pointer"
        />
      </label>
      <Slider label="Size" value={size} min={1} max={500} step={1} onChange={onSizeChange} />
      <Slider label="Hardness" value={hardness} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={onHardnessChange} />
      <Slider label="Opacity" value={opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={onOpacityChange} />
      <Slider label="Flow" value={flow} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={onFlowChange} />
    </div>
  );
}
