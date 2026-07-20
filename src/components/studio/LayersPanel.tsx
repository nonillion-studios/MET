import { useState } from 'react';
import {
  Eye, EyeOff, Lock, Unlock, Plus, Copy, Trash2, ChevronUp, ChevronDown, SlidersHorizontal,
  FolderPlus, ChevronRight, FolderOpen, CornerDownRight, Settings2,
} from 'lucide-react';
import { IconButton } from '../ui';
import { cn } from '../ui/cn';
import { StudioPanel } from './StudioPanel';
import {
  flattenWithPaths, canMove, findLayer, getParent, getSiblings, isDescendantOf, canBeClipBase, type LayerPath,
} from './layerTree';
import { LAYER_TYPE_ICON, BLEND_MODES, type StudioLayer, type LayerSelectMode } from './studioTypes';

/** Where a drop lands relative to the row under the cursor. */
type DropZone = 'above' | 'into' | 'below';

/** The layer immediately beneath `id` among its own siblings — a clipped layer's base. */
function layerBelow(layers: StudioLayer[], id: string): StudioLayer | null {
  const siblings = getSiblings(layers, id);
  const index = siblings.findIndex(l => l.id === id);
  return index > 0 ? siblings[index - 1] : null;
}

interface LayersPanelProps {
  layers: StudioLayer[];
  /** The primary layer — the one the single-layer panels follow. Always the last of `selectedLayerIds`. */
  activeLayerId: string | null;
  /** The full canvas selection; the primary is highlighted more strongly than the rest. */
  selectedLayerIds?: string[];
  onSelect: (id: string, mode?: LayerSelectMode) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onBlendChange: (id: string, blendMode: StudioLayer['blendMode']) => void;
  onAdd: () => void;
  onAddAdjustment: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onGroup?: () => void;
  onUngroup?: (id: string) => void;
  onToggleCollapsed?: (id: string) => void;
  /** Clip this layer to the raster layer directly below it, or release it. */
  onToggleClipped?: (id: string) => void;
  /** Adds a mask to this layer if it has none, or removes its existing one. Any layer type may
   *  carry a mask (groups included), so unlike clipping there's no eligibility gate. */
  onToggleMask?: (id: string) => void;
  /** Toggles an existing mask's `enabled` flag without removing it. */
  onToggleMaskEnabled?: (id: string) => void;
  /** Makes this layer's mask (rather than its own content) the current paint target. */
  onSelectMask?: (id: string) => void;
  /** The layer whose mask is currently the paint target, or null. */
  activeMaskLayerId?: string | null;
  /** `index` is read against the destination list *after* the dragged layer is detached. */
  onReparent?: (id: string, newParentId: string | null, index: number) => void;
  /** Renames a layer — double-click the name to edit it inline. */
  onRename?: (id: string, name: string) => void;
  /** Explicit "open full settings" intent (the Text/Adjustment panel) — separate from onSelect, so
   *  a plain click never navigates away from this list. No-ops for layer types without a panel. */
  onOpenSettings?: (id: string) => void;
  /**
   * Which row has its properties (opacity/blend/actions) disclosed.
   *
   * Lifted to `Studio` rather than kept here: selecting a text or adjustment layer auto-switches
   * the dock to that layer's panel, which shares a region with this one — so this panel unmounts
   * and local state would be lost. That made a text or adjustment layer's opacity slider literally
   * unreachable: every click that expanded the row also navigated away from it, and coming back
   * found the row collapsed again.
   */
  expandedLayerId: string | null;
  onToggleExpanded: (id: string) => void;
  /** When it's docked in the persistent Color+Layers column, the wrapper controls the collapse
   *  height — this just renders the toggle button in the header's actions slot. Distinct from
   *  `onToggleCollapsed` above, which collapses a *group layer's* subtree in the tree, not the
   *  whole panel. */
  panelCollapsed?: boolean;
  onTogglePanelCollapsed?: () => void;
}

export function LayersPanel({
  layers, activeLayerId, selectedLayerIds, onSelect, onToggleVisible, onToggleLocked,
  onOpacityChange, onBlendChange, onAdd, onAddAdjustment, onDuplicate, onDelete, onMove,  onGroup, onUngroup, onToggleCollapsed, onToggleClipped, onReparent, onRename, onOpenSettings,
  expandedLayerId, onToggleExpanded, panelCollapsed, onTogglePanelCollapsed,
}: LayersPanelProps) {
  const selected = selectedLayerIds ?? (activeLayerId ? [activeLayerId] : []);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: DropZone } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  function commitRename() {
    const id = renamingId;
    setRenamingId(null);
    if (!id) return;
    const trimmed = renameValue.trim();
    if (trimmed) onRename?.(id, trimmed);
  }

  // Render top-most layer first, matching Photoshop's stacking convention. Reversing the flattened
  // walk puts a group directly above its own children, which is the order the panel wants to indent.
  const ordered = [...flattenWithPaths(layers)]
    .reverse()
    .filter(({ path }) => !isInsideCollapsedGroup(layers, path));

  /** True when any ancestor of `path` is a collapsed group — those rows stay hidden. */
  function isInsideCollapsedGroup(list: StudioLayer[], path: LayerPath): boolean {
    let current = list;
    for (let i = 0; i < path.length - 1; i += 1) {
      const ancestor = current[path[i]];
      if (!ancestor) return false;
      if (ancestor.collapsed) return true;
      current = ancestor.children ?? [];
    }
    return false;
  }

  /** Splits the row into three drop zones by cursor position: outer quarters insert above/below,
   *  the middle half drops *into* a group. Only groups accept 'into'. */
  function zoneFor(e: React.DragEvent, layer: StudioLayer): DropZone {
    const rect = e.currentTarget.getBoundingClientRect();
    const offset = (e.clientY - rect.top) / rect.height;
    if (layer.type === 'group' && offset > 0.25 && offset < 0.75) return 'into';
    // The panel is top-most-first, so visually "above" is a *higher* index in the data.
    return offset < 0.5 ? 'above' : 'below';
  }

  /** Whether a drop is even conceivable. `layerTree.reparent` is the real authority and no-ops on
   *  anything illegal; this only exists so the UI doesn't advertise a drop that can't happen. */
  function canDrop(id: string, target: StudioLayer, zone: DropZone): boolean {
    if (id === target.id) return false;
    if (target.isBackground && zone !== 'above') return false;
    if (findLayer(layers, id)?.isBackground) return false;
    if (isDescendantOf(layers, target.id, id)) return false;
    if (zone === 'into' && target.type !== 'group') return false;
    return true;
  }

  function handleDrop(target: StudioLayer, zone: DropZone) {
    const id = dragId;
    setDragId(null);
    setDropTarget(null);
    if (!id || !onReparent || !canDrop(id, target, zone)) return;

    if (zone === 'into') {
      // Drop on top of the group's existing children.
      onReparent(id, target.id, (target.children ?? []).length);
      return;
    }

    const parent = getParent(layers, target.id);
    const siblings = parent ? parent.children ?? [] : layers;
    const targetIndex = siblings.findIndex(s => s.id === target.id);
    if (targetIndex < 0) return;

    // `reparent` detaches before inserting, so an index past the dragged layer's own old slot in
    // the same list shifts down by one. Computing this against the pre-move list is the classic
    // off-by-one here.
    const draggedIndex = siblings.findIndex(s => s.id === id);
    let index = zone === 'above' ? targetIndex + 1 : targetIndex;
    if (draggedIndex >= 0 && draggedIndex < index) index -= 1;

    onReparent(id, parent?.id ?? null, index);
  }

  return (
    <StudioPanel
      title="Layers"
      bare
      bodyClassName="py-1.5 px-1.5 flex flex-col gap-1"
      actions={
        <>
          <IconButton size="sm" aria-label="Group layers" title="Group selected layers" onClick={onGroup} className="!bg-transparent">
            <FolderPlus size={13} />
          </IconButton>
          <IconButton size="sm" aria-label="Add adjustment layer" title="Add adjustment layer" onClick={onAddAdjustment} className="!bg-transparent">
            <SlidersHorizontal size={13} />
          </IconButton>
          <IconButton size="sm" aria-label="Add layer" title="Add raster layer" onClick={onAdd} className="!bg-transparent">
            <Plus size={14} />
          </IconButton>
          {onTogglePanelCollapsed && (
            <IconButton size="sm" aria-label={panelCollapsed ? 'Expand Layers panel' : 'Collapse Layers panel'} onClick={onTogglePanelCollapsed} className="!bg-transparent">
              {panelCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </IconButton>
          )}
        </>
      }
    >
        {ordered.map(({ layer, depth }) => {
          const Icon = LAYER_TYPE_ICON[layer.type];
          const active = layer.id === activeLayerId;
          const inSelection = selected.includes(layer.id);
          const expanded = expandedLayerId === layer.id;
          const isGroup = layer.type === 'group';
          const drop = dropTarget?.id === layer.id ? dropTarget.zone : null;

          return (
            <div
              key={layer.id}
              draggable={!layer.isBackground && !!onReparent}
              onDragStart={() => setDragId(layer.id)}
              onDragEnd={() => { setDragId(null); setDropTarget(null); }}
              onDragOver={(e) => {
                if (!dragId || !onReparent) return;
                const zone = zoneFor(e, layer);
                if (!canDrop(dragId, layer, zone)) return;
                e.preventDefault();
                setDropTarget({ id: layer.id, zone });
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => { e.preventDefault(); handleDrop(layer, zoneFor(e, layer)); }}
              style={{ marginLeft: depth * 12 }}
              className={cn(
                'rounded-control border transition-colors',
                dragId === layer.id && 'opacity-40',
                // The drop affordance has to say *which* of the three things will happen.
                drop === 'into' && 'ring-1 ring-accent',
                drop === 'above' && 'border-t-2 !border-t-accent',
                drop === 'below' && 'border-b-2 !border-b-accent',
                active ? 'bg-accent-soft border-accent/30'
                  // Also selected, but not the primary — dimmer, so it's clear which layer the
                  // single-layer panels are actually following.
                  : inSelection ? 'bg-accent-soft/40 border-accent/20'
                  : 'bg-ink/5 border-transparent hover:bg-ink/5'
              )}
            >
              {(() => {
                const isRenaming = renamingId === layer.id;
                const rowInner = (
                  <>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                      onClick={(e) => { e.stopPropagation(); onToggleVisible(layer.id); }}
                      className="shrink-0 w-6 h-6 flex items-center justify-center text-ink-faint hover:text-ink"
                    >
                      {layer.visible ? <Eye size={14} /> : <EyeOff size={14} className="opacity-40" />}
                    </span>

                    {/* Collapse chevron — a group's *subtree* visibility in the panel, which is a
                        different thing from `expandedId` (this row's own properties disclosure). */}
                    {isGroup ? (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={layer.collapsed ? `Expand ${layer.name}` : `Collapse ${layer.name}`}
                        onClick={(e) => { e.stopPropagation(); onToggleCollapsed?.(layer.id); }}
                        className="shrink-0 w-4 h-6 flex items-center justify-center text-ink-faint hover:text-ink"
                      >
                        {layer.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      </span>
                    ) : (
                      <span className="shrink-0 w-4" />
                    )}

                    <span className={cn('shrink-0 w-6 h-6 rounded-control flex items-center justify-center', active ? 'text-accent' : 'text-ink-faint')}>
                      {isGroup && !layer.collapsed ? <FolderOpen size={14} /> : <Icon size={14} />}
                    </span>

                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onBlur={commitRename}
                        className="flex-1 min-w-0 bg-ink/10 border border-accent/40 rounded-control px-1.5 py-0.5 text-ui text-ink outline-none"
                      />
                    ) : (
                      <span
                        className={cn('flex-1 min-w-0 text-left text-ui font-medium truncate', active ? 'text-ink' : 'text-ink/80')}
                        onDoubleClick={(e) => {
                          if (!onRename) return;
                          e.stopPropagation();
                          setRenameValue(layer.name);
                          setRenamingId(layer.id);
                        }}
                      >
                        {layer.name}
                      </span>
                    )}
                {/* Mask chip — always visible (not gated behind the row's own disclosure) so it's
                    reachable with one click, matching Photoshop's layer-thumbnail/mask-thumbnail
                    pair. Not a live pixel preview (that would need a new thumbnail-rendering
                    pipeline); just an indicator of presence/enabled/active-paint-target state. */}
                {layer.mask && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={activeMaskLayerId === layer.id ? `Stop editing ${layer.name}'s mask` : `Edit ${layer.name}'s mask`}
                    title={layer.mask.enabled ? 'Layer mask (click to edit)' : 'Layer mask (disabled)'}
                    onClick={(e) => { e.stopPropagation(); onSelectMask?.(layer.id); }}
                    className={cn(
                      'shrink-0 w-5 h-5 rounded border flex items-center justify-center',
                      activeMaskLayerId === layer.id ? 'border-accent bg-accent-soft text-accent'
                        : layer.mask.enabled ? 'border-hairline text-ink-faint hover:text-ink'
                        : 'border-hairline text-ink-faint/40'
                    )}
                  >
                    <Contrast size={11} />
                  </span>
                )}

                <span className={cn('flex-1 min-w-0 text-left text-ui font-medium truncate', active ? 'text-ink' : 'text-ink/80')}>
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
                  </>
                );
                // A real <button> whenever possible (matches every other row-as-button convention
                // in this panel and keeps plain `locator('button')` queries working) — an <input>
                // can't validly nest inside one, so renaming swaps to a plain <div> for that one row.
                return isRenaming ? (
                  <div className="w-full flex items-center gap-2 px-2 h-11">{rowInner}</div>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      onSelect(layer.id, e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
                      onToggleExpanded(layer.id);
                    }}
                    className="w-full flex items-center gap-2 px-2 h-11"
                  >
                    {rowInner}
                  </button>
                );
              })()}

              {expanded && (
                <div className="px-3 pb-2.5 pt-0.5 flex flex-col gap-2 border-t border-hairline/60 mx-2">
                  {!layer.isBackground && (
                    <>
                      <label className="flex items-center gap-2 text-micro text-ink-faint">
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

                      {/* No blend control for adjustment layers. Photoshop blends an adjustment's
                          result against its unadjusted backdrop, and our adjustment wraps the very
                          stack it would need as that backdrop — so there's nothing to blend with.
                          Opacity works (it's folded into the filter as a strength); blend can't be,
                          and an inert dropdown would be worse than none. */}
                      {layer.type !== 'adjustment' && (
                        <label className="flex items-center gap-2 text-micro text-ink-faint">
                          <span className="w-14 shrink-0">Blend</span>
                          <select
                            value={layer.blendMode}
                            onChange={(e) => onBlendChange(layer.id, e.target.value as StudioLayer['blendMode'])}
                            className="flex-1 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
                          >
                            {BLEND_MODES.map(bm => <option key={bm.id} value={bm.id}>{bm.label}</option>)}
                          </select>
                        </label>
                      )}
                    </>
                  )}

                  <div className="flex items-center gap-1 pt-0.5">
                    {/* Bounds come from layerTree — a root-array index comparison is meaningless
                        once a layer can sit inside a group. */}
                    <IconButton size="sm" aria-label="Move up" disabled={!canMove(layers, layer.id, 'up')} onClick={() => onMove(layer.id, 'up')} className="!bg-transparent !w-7 !h-7">
                      <ChevronUp size={13} />
                    </IconButton>
                    <IconButton size="sm" aria-label="Move down" disabled={!canMove(layers, layer.id, 'down')} onClick={() => onMove(layer.id, 'down')} className="!bg-transparent !w-7 !h-7">
                      <ChevronDown size={13} />
                    </IconButton>
                    {onToggleMask && !layer.isBackground && layer.type !== 'adjustment' && (
                      <IconButton
                        size="sm"
                        aria-label={layer.mask ? 'Delete mask' : 'Add mask'}
                        title={layer.mask ? 'Delete layer mask' : 'Add layer mask (from selection, or reveal-all)'}
                        onClick={() => onToggleMask(layer.id)}
                        className="!bg-transparent !w-7 !h-7"
                      >
                        <Contrast size={12} className={layer.mask ? 'text-accent' : undefined} />
                      </IconButton>
                    )}
                    {layer.mask && onToggleMaskEnabled && (
                      <IconButton
                        size="sm"
                        aria-label={layer.mask.enabled ? 'Disable layer mask' : 'Enable layer mask'}
                        title={layer.mask.enabled ? 'Disable layer mask' : 'Enable layer mask'}
                        onClick={() => onToggleMaskEnabled(layer.id)}
                        className="!bg-transparent !w-7 !h-7"
                      >
                        {layer.mask.enabled ? <Eye size={12} /> : <EyeOff size={12} className="opacity-40" />}
                      </IconButton>
                    )}
                    {onToggleClipped && !layer.isBackground && (
                      <IconButton
                        size="sm"
                        aria-label={layer.clipped ? 'Release clipping mask' : 'Create clipping mask'}
                        title={
                          layer.clipped ? 'Release clipping mask'
                            : canBeClipBase(layerBelow(layers, layer.id)) ? 'Clip to the layer below'
                            : 'Clipping needs a raster layer directly below'
                        }
                        disabled={!layer.clipped && !canBeClipBase(layerBelow(layers, layer.id))}
                        onClick={() => onToggleClipped(layer.id)}
                        className="!bg-transparent !w-7 !h-7"
                      >
                        <CornerDownRight size={12} className={layer.clipped ? 'text-accent' : undefined} />
                      </IconButton>
                    )}
                    <div className="flex-1" />
                    {onOpenSettings && (layer.type === 'text' || layer.type === 'adjustment') && (
                      <IconButton size="sm" aria-label="Open layer settings" title="Open full settings" onClick={() => onOpenSettings(layer.id)} className="!bg-transparent !w-7 !h-7">
                        <Settings2 size={12} />
                      </IconButton>
                    )}
                    {isGroup && onUngroup && (
                      <IconButton size="sm" aria-label="Ungroup layers" title="Ungroup" onClick={() => onUngroup(layer.id)} className="!bg-transparent !w-7 !h-7">
                        <FolderOpen size={12} />
                      </IconButton>
                    )}
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
    </StudioPanel>
  );
}
