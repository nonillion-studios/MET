import { Eye, EyeOff, Sliders } from 'lucide-react';
import { StudioPanel } from '../StudioPanel';
import { TextPanel } from '../TextPanel';
import { AdjustmentPanel } from '../AdjustmentPanel';
import { BLEND_MODES, type StudioLayer, type TextLayerData, type AdjustmentLayerData } from '../studioTypes';
import type { TextSelection } from '../StudioCanvas';

interface PropertiesPanelProps {
  layer: StudioLayer | null;
  onUpdateText: (id: string, patch: Partial<TextLayerData>) => void;
  onCenterText: (id: string) => void;
  fontFamilies?: string[];
  textSelection?: TextSelection | null;
  selectedLineIndex?: number | null;
  onUpdateAdjustment: (id: string, patch: Partial<AdjustmentLayerData>) => void;
  getHistogramSource?: () => HTMLCanvasElement | null;
  onToggleVisible: (id: string) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onBlendChange: (id: string, blendMode: StudioLayer['blendMode']) => void;
  onOpenBlendingOptions: (id: string) => void;
}

/** Generic properties for a layer type with no dedicated panel of its own (image/placed, paint,
 *  path, group, background) — the fields every `StudioLayer` already has regardless of type, using
 *  the exact same `Studio.tsx` handlers (`onOpacityChange`/`onBlendChange`/`onToggleVisible`) the
 *  Layers panel's own inline row already calls, so this is a second entry point onto real state,
 *  not a parallel one. Effects/filters live behind "Blending Options…" (`BlendingOptionsDialog`)
 *  rather than being duplicated here. */
function GenericLayerProperties({ layer, onToggleVisible, onOpacityChange, onBlendChange, onOpenBlendingOptions }: {
  layer: StudioLayer;
  onToggleVisible: (id: string) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onBlendChange: (id: string, blendMode: StudioLayer['blendMode']) => void;
  onOpenBlendingOptions: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-micro text-ink truncate">{layer.name}</span>
        <button
          type="button"
          onClick={() => onToggleVisible(layer.id)}
          aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
          className="shrink-0 w-6 h-6 flex items-center justify-center text-ink-faint hover:text-ink"
        >
          {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>

      <label className="flex items-center gap-2 text-micro text-ink-faint">
        <span className="w-16 shrink-0">Opacity</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(layer.opacity * 100)}
          onChange={(e) => onOpacityChange(layer.id, Number(e.target.value) / 100)}
          className="flex-1 accent-[var(--color-accent)]"
        />
        <span className="w-8 text-right tabular-nums">{Math.round(layer.opacity * 100)}</span>
      </label>

      <label className="flex flex-col gap-1 text-micro text-ink-faint">
        <span>Blend Mode</span>
        <select
          value={layer.blendMode}
          onChange={(e) => onBlendChange(layer.id, e.target.value as StudioLayer['blendMode'])}
          className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
        >
          {BLEND_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>

      <button
        type="button"
        onClick={() => onOpenBlendingOptions(layer.id)}
        className="studio-interactive flex items-center gap-2 px-2 py-1.5 rounded-control border border-hairline text-micro text-ink-faint hover:text-ink hover:bg-ink/5"
      >
        <Sliders size={13} />
        Blending Options…
      </button>
    </div>
  );
}

/**
 * Context-aware Properties panel: one dock entry whose content switches with the current
 * selection, replacing the old always-two-separate-entries (`text`, `adjustment`) registration —
 * `TextPanel`/`AdjustmentPanel` themselves are unchanged, this only decides which one (if either)
 * gets mounted. A layer type with no dedicated editor (image, paint, path, group, background) gets
 * `GenericLayerProperties` instead of nothing, and no selection gets an honest empty state rather
 * than fabricated document/canvas controls that don't exist as real settings yet.
 */
export function PropertiesPanel({
  layer, onUpdateText, onCenterText, fontFamilies, textSelection, selectedLineIndex,
  onUpdateAdjustment, getHistogramSource, onToggleVisible, onOpacityChange, onBlendChange, onOpenBlendingOptions,
}: PropertiesPanelProps) {
  if (!layer) {
    return (
      <StudioPanel title="Properties" hideTitle bodyClassName="px-3 py-6 flex items-center justify-center text-center">
        <span className="text-micro text-ink-faint">Select a layer to see its properties.</span>
      </StudioPanel>
    );
  }

  if (layer.type === 'text') {
    return (
      <TextPanel
        layer={layer}
        onUpdate={onUpdateText}
        onCenter={onCenterText}
        fontFamilies={fontFamilies}
        selection={textSelection}
        selectedLineIndex={selectedLineIndex}
        hideTitle
      />
    );
  }

  if (layer.type === 'adjustment') {
    return (
      <AdjustmentPanel
        layer={layer}
        onUpdate={onUpdateAdjustment}
        getHistogramSource={getHistogramSource}
        onToggleVisible={() => onToggleVisible(layer.id)}
        hideTitle
      />
    );
  }

  return (
    <StudioPanel title="Properties" hideTitle>
      <GenericLayerProperties
        layer={layer}
        onToggleVisible={onToggleVisible}
        onOpacityChange={onOpacityChange}
        onBlendChange={onBlendChange}
        onOpenBlendingOptions={onOpenBlendingOptions}
      />
    </StudioPanel>
  );
}
