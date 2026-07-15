import { useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, Plus, Copy, Trash2, ChevronUp, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { IconButton } from '../ui';
import { cn } from '../ui/cn';
import { LAYER_TYPE_ICON, BLEND_MODES, type StudioLayer } from './studioTypes';

interface LayersPanelProps {
  layers: StudioLayer[];
  activeLayerId: string | null;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onBlendChange: (id: string, blendMode: StudioLayer['blendMode']) => void;
  onAdd: () => void;
  onAddAdjustment: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
}

export function LayersPanel({
  layers, activeLayerId, onSelect, onToggleVisible, onToggleLocked,
  onOpacityChange, onBlendChange, onAdd, onAddAdjustment, onDuplicate, onDelete, onMove,
}: LayersPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Render top-most layer first, matching Photoshop's stacking convention.
  const ordered = [...layers].reverse();

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-hairline">
        <span className="text-xs font-display font-semibold text-ink-faint uppercase tracking-wide">Layers</span>
        <div className="flex items-center gap-0.5">
          <IconButton size="sm" aria-label="Add adjustment layer" title="Add adjustment layer" onClick={onAddAdjustment} className="!bg-transparent">
            <SlidersHorizontal size={13} />
          </IconButton>
          <IconButton size="sm" aria-label="Add layer" title="Add raster layer" onClick={onAdd} className="!bg-transparent">
            <Plus size={14} />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-1.5 px-1.5 flex flex-col gap-1">
        {ordered.map((layer) => {
          const Icon = LAYER_TYPE_ICON[layer.type];
          const active = layer.id === activeLayerId;
          const expanded = expandedId === layer.id;
          const realIndex = layers.findIndex(l => l.id === layer.id);

          return (
            <div
              key={layer.id}
              className={cn(
                'rounded-lg border transition-colors',
                active ? 'bg-accent-soft border-accent/30' : 'bg-ink/[0.03] border-transparent hover:bg-ink/5'
              )}
            >
              <button
                type="button"
                onClick={() => { onSelect(layer.id); setExpandedId(expanded ? null : layer.id); }}
                className="w-full flex items-center gap-2 px-2 h-11"
              >
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                  onClick={(e) => { e.stopPropagation(); onToggleVisible(layer.id); }}
                  className="shrink-0 w-6 h-6 flex items-center justify-center text-ink-faint hover:text-ink"
                >
                  {layer.visible ? <Eye size={14} /> : <EyeOff size={14} className="opacity-40" />}
                </span>

                <span className={cn('shrink-0 w-6 h-6 rounded-md flex items-center justify-center', active ? 'text-accent' : 'text-ink-faint')}>
                  <Icon size={14} />
                </span>

                <span className={cn('flex-1 min-w-0 text-left text-xs font-medium truncate', active ? 'text-ink' : 'text-ink/80')}>
                  {layer.name}
                </span>

                {!layer.isBackground && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                    onClick={(e) => { e.stopPropagation(); onToggleLocked(layer.id); }}
                    className="shrink-0 w-6 h-6 flex items-center justify-center text-ink-faint hover:text-ink"
                  >
                    {layer.locked ? <Lock size={13} /> : <Unlock size={13} className="opacity-30" />}
                  </span>
                )}
              </button>

              {expanded && (
                <div className="px-3 pb-2.5 pt-0.5 flex flex-col gap-2 border-t border-hairline/60 mx-2">
                  {!layer.isBackground && (
                    <>
                      <label className="flex items-center gap-2 text-[11px] text-ink-faint">
                        <span className="w-14 shrink-0">Opacity</span>
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

                      <label className="flex items-center gap-2 text-[11px] text-ink-faint">
                        <span className="w-14 shrink-0">Blend</span>
                        <select
                          value={layer.blendMode}
                          onChange={(e) => onBlendChange(layer.id, e.target.value as StudioLayer['blendMode'])}
                          className="flex-1 bg-ink/5 border border-hairline rounded-md px-1.5 py-1 text-ink text-[11px]"
                        >
                          {BLEND_MODES.map(bm => <option key={bm.id} value={bm.id}>{bm.label}</option>)}
                        </select>
                      </label>
                    </>
                  )}

                  <div className="flex items-center gap-1 pt-0.5">
                    <IconButton size="sm" aria-label="Move up" disabled={realIndex >= layers.length - 1} onClick={() => onMove(layer.id, 'up')} className="!bg-transparent !w-7 !h-7">
                      <ChevronUp size={13} />
                    </IconButton>
                    <IconButton size="sm" aria-label="Move down" disabled={realIndex <= 0} onClick={() => onMove(layer.id, 'down')} className="!bg-transparent !w-7 !h-7">
                      <ChevronDown size={13} />
                    </IconButton>
                    <div className="flex-1" />
                    <IconButton size="sm" aria-label="Duplicate layer" onClick={() => onDuplicate(layer.id)} className="!bg-transparent !w-7 !h-7">
                      <Copy size={12} />
                    </IconButton>
                    {!layer.isBackground && (
                      <IconButton size="sm" aria-label="Delete layer" onClick={() => onDelete(layer.id)} className="!bg-transparent !w-7 !h-7 hover:!text-red-400">
                        <Trash2 size={12} />
                      </IconButton>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
