import { Fragment, useState, type ReactNode } from 'react';
import { cn } from '../../ui/cn';
import { CollapsiblePanel, type PanelMenuItem } from './CollapsiblePanel';
import { PanelTabGroup } from './PanelTabGroup';
import { usePanelLayout } from './PanelLayoutContext';
import { PANEL_BY_ID, PANEL_GROUP_LABELS } from './panelRegistry';

export interface PanelStackEntry {
  id: string;
  label: string;
  content: ReactNode;
  /** Extra, panel-specific menu actions folded into the panel's own combined Close/Reset
   *  Height/... menu — omitted entirely when a panel has nothing real to add there. */
  menuItems?: PanelMenuItem[];
}

interface PanelStackProps {
  panels: PanelStackEntry[];
  className?: string;
}

/** A 4px `row-resize` divider between two adjacent visible panels — drags `layout.resizeAdjacent`
 *  live on every pointermove (incremental per-move deltas, not a start/end diff), so a panel
 *  clamped at its `minHeight` mid-drag can still grow again the moment the pointer reverses,
 *  without any separate "have we hit the limit" bookkeeping here. */
function ResizeDivider({ aboveId, belowId }: { aboveId: string; belowId: string }) {
  const layout = usePanelLayout();

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    let lastY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientY - lastY;
      lastY = ev.clientY;
      if (delta !== 0) layout.resizeAdjacent(aboveId, belowId, delta);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <div
      onPointerDown={handlePointerDown}
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Resize between ${aboveId} and ${belowId} panels`}
      className="h-1 shrink-0 cursor-row-resize bg-transparent hover:bg-accent/40 active:bg-accent/60 transition-colors"
    />
  );
}

/**
 * The stacked, collapsible, resizable, reorderable, maximizable right-column panel column —
 * replaces the old single-active-tab `RightDock`. Every entry in `panels` that's currently
 * visible (per `PanelLayoutContext`) renders as a `CollapsiblePanel`, in the user's own saved
 * order, with a real resize divider between each adjacent pair.
 */
export function PanelStack({ panels, className }: PanelStackProps) {
  const layout = usePanelLayout();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ id: string; before: boolean } | null>(null);
  // Which member of a tab-grouped row is currently showing — not persisted (deliberately lightweight
  // per-session UI state, not layout), keyed by group name so switching pages/panels doesn't need
  // its own reset logic; defaults to whichever member is the row's anchor when never touched.
  const [activeGroupTab, setActiveGroupTab] = useState<Record<string, string>>({});

  const byId = new Map(panels.map(p => [p.id, p]));
  const visibleOrder = layout.order.filter(id => byId.has(id) && layout.isVisible(id));

  // Collapse consecutive-in-registry-group visible ids into one row each, rendered at whichever
  // member appears first in `visibleOrder` — a group with only one currently-visible member is just
  // that one id, unmerged. See panelRegistry.ts's `group` field doc comment.
  const groupOf = (id: string) => PANEL_BY_ID.get(id)?.group;
  const seenGroups = new Set<string>();
  const rows: { anchorId: string; memberIds: string[] }[] = [];
  for (const id of visibleOrder) {
    const g = groupOf(id);
    if (g) {
      if (seenGroups.has(g)) continue;
      seenGroups.add(g);
      rows.push({ anchorId: id, memberIds: visibleOrder.filter(otherId => groupOf(otherId) === g) });
    } else {
      rows.push({ anchorId: id, memberIds: [id] });
    }
  }

  const maximized = layout.maximizedId && byId.has(layout.maximizedId) && layout.isVisible(layout.maximizedId)
    ? byId.get(layout.maximizedId)!
    : null;

  if (maximized) {
    return (
      <div className={cn('h-full flex flex-col min-h-0', className)}>
        <CollapsiblePanel
          id={maximized.id}
          title={maximized.label}
          collapsed={false}
          onToggleCollapsed={() => layout.toggleCollapsed(maximized.id)}
          maximized
          onToggleMaximized={() => layout.toggleMaximized(maximized.id)}
          grow={PANEL_BY_ID.get(maximized.id)?.grow}
          height={layout.heightOf(maximized.id)}
          onClose={() => layout.setVisible(maximized.id, false)}
          onResetHeight={() => layout.resetHeight(maximized.id)}
          menuItems={maximized.menuItems}
          draggedOver={null}
          onDragStart={() => {}}
          onDragEnd={() => {}}
          onDragOverHeader={() => {}}
          onDropOnHeader={() => {}}
        >
          {maximized.content}
        </CollapsiblePanel>
      </div>
    );
  }

  return (
    <div className={cn('h-full flex flex-col min-h-0 overflow-y-auto', className)}>
      {rows.map(({ anchorId: id, memberIds }, i) => {
        const entry = byId.get(id)!;
        const group = memberIds.length > 1 ? groupOf(id) : undefined;
        const title = group ? (PANEL_GROUP_LABELS[group] ?? entry.label) : entry.label;
        const content = group ? (
          <PanelTabGroup
            members={memberIds.map(memberId => ({ id: memberId, label: byId.get(memberId)!.label, content: byId.get(memberId)!.content }))}
            activeId={activeGroupTab[group] ?? id}
            onTabChange={(memberId) => setActiveGroupTab(s => ({ ...s, [group]: memberId }))}
          />
        ) : entry.content;
        return (
          // A Fragment, not a wrapper div: the grow (Layers) panel's own `flex-1` needs to be a
          // direct child of this outer flex column to actually expand — an intermediate wrapper
          // div here would itself need `flex-1` too, or Layers would have nothing to grow into.
          <Fragment key={id}>
            {i > 0 && <ResizeDivider aboveId={rows[i - 1].anchorId} belowId={id} />}
            <CollapsiblePanel
              id={id}
              title={title}
              collapsed={layout.isCollapsed(id)}
              onToggleCollapsed={() => layout.toggleCollapsed(id)}
              maximized={false}
              onToggleMaximized={() => layout.toggleMaximized(id)}
              grow={PANEL_BY_ID.get(id)?.grow}
              height={layout.heightOf(id)}
              onClose={() => layout.setVisible(id, false)}
              onResetHeight={() => layout.resetHeight(id)}
              menuItems={entry.menuItems}
              draggedOver={dragOver?.id === id ? (dragOver.before ? 'above' : 'below') : null}
              onDragStart={() => setDragId(id)}
              onDragEnd={() => { setDragId(null); setDragOver(null); }}
              onDragOverHeader={(before) => { if (dragId && dragId !== id) setDragOver({ id, before }); }}
              onDropOnHeader={() => {
                if (dragId && dragId !== id && dragOver) layout.reorder(dragId, id, dragOver.before);
                setDragId(null);
                setDragOver(null);
              }}
            >
              {content}
            </CollapsiblePanel>
          </Fragment>
        );
      })}
    </div>
  );
}
