import { findTool } from '../toolGroups';

interface ToolOptionsBarProps {
  activeTool: string;
  size: number;
  onSizeChange: (v: number) => void;
  hardness: number;
  onHardnessChange: (v: number) => void;
  opacity: number;
  onOpacityChange: (v: number) => void;
  flow: number;
  onFlowChange: (v: number) => void;
  tolerance: number;
  onToleranceChange: (v: number) => void;
}

const SIZE_TOOLS = new Set(['brush', 'pencil', 'eraser', 'clone', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'spot-heal', 'shape-rect', 'shape-ellipse', 'shape-line']);
const HARDNESS_TOOLS = new Set(['brush', 'clone']);
const FLOW_TOOLS = new Set(['brush', 'pencil', 'eraser', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge']);
const OPACITY_TOOLS = new Set(['brush', 'pencil', 'eraser', 'bucket', 'gradient']);
const TOLERANCE_TOOLS = new Set(['wand', 'bucket']);

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-ink-faint shrink-0">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-24 accent-[var(--color-accent)]" />
      <span className="w-8 text-right tabular-nums text-ink">{format ? format(value) : Math.round(value)}</span>
    </label>
  );
}

export function ToolOptionsBar({ activeTool, size, onSizeChange, hardness, onHardnessChange, opacity, onOpacityChange, flow, onFlowChange, tolerance, onToleranceChange }: ToolOptionsBarProps) {
  const tool = findTool(activeTool);
  const showSize = SIZE_TOOLS.has(activeTool);
  const showHardness = HARDNESS_TOOLS.has(activeTool);
  const showFlow = FLOW_TOOLS.has(activeTool);
  const showOpacity = OPACITY_TOOLS.has(activeTool);
  const showTolerance = TOLERANCE_TOOLS.has(activeTool);

  if (!tool || (!showSize && !showHardness && !showFlow && !showOpacity && !showTolerance)) return null;

  return (
    <div className="liquid-glass-bar flex items-center gap-4 px-3 h-10 shrink-0 border-b border-hairline overflow-x-auto">
      <span className="text-xs font-medium text-ink shrink-0">{tool.label}</span>
      {showSize && <Slider label="Size" value={size} min={1} max={200} step={1} onChange={onSizeChange} />}
      {showHardness && <Slider label="Hardness" value={hardness * 100} min={0} max={100} step={1} onChange={(v) => onHardnessChange(v / 100)} format={(v) => `${Math.round(v)}%`} />}
      {showFlow && <Slider label="Flow" value={flow * 100} min={0} max={100} step={1} onChange={(v) => onFlowChange(v / 100)} format={(v) => `${Math.round(v)}%`} />}
      {showOpacity && <Slider label="Opacity" value={opacity * 100} min={0} max={100} step={1} onChange={(v) => onOpacityChange(v / 100)} format={(v) => `${Math.round(v)}%`} />}
      {showTolerance && <Slider label="Tolerance" value={tolerance} min={0} max={100} step={1} onChange={onToleranceChange} />}
    </div>
  );
}
