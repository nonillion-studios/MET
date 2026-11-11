import { useState } from 'react';
import { cn } from '../../ui/cn';
import { usePanelLayout } from './PanelLayoutContext';
import { PANEL_BY_ID } from './panelRegistry';
import type { PanelStackEntry } from './PanelStack';

interface TabbedPanelGroupProps {
  groupKey: string;
  entries: PanelStackEntry[];
  grow: boolean;
  draggedOver: 'above' | 'below' | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOverHeader: (before: boolean) => void;
  onDropOnHeader: () => void;
}

const FALLBACK_HEIGHT = 240;

export function TabbedPanelGroup({
  groupKey, entries, grow, draggedOver, onDragStart, onDragEnd, onDragOverHeader, onDropOnHeader,
}: TabbedPanelGroupProps) {
  const layout = usePanelLayout();
  const [activeTab, setActiveTab] = useState(entries[0]?.id ?? '');
  const activeEntry = entries.find(e => e.id === activeTab) ?? entries[0];
  const activeDef = PANEL_BY_ID.get(activeEntry.id);
  const collapsed = layout.isCollapsed(activeEntry.id);
  const height = layout.heightOf(activeEntry.id);
  const isGrowExpanded = grow && !collapsed;

  const tabBar = (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', activeEntry.id); onDragStart(activeEntry.id); }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onDragOverHeader(e.clientY < rect.top + rect.height / 2);
      }}
      onDrop={(e) => { e.preventDefault(); onDropOnHeader(); }}
      className={cn(
        'flex items-stretch shrink-0 border-b border-hairline/70 select-none',
        draggedOver === 'above' && 'border-t-2 !border-t-accent',
        draggedOver === 'below' && 'border-b-2 !border-b-accent'
      )}
    >
      {entries.map(entry => (
        <button
          key={entry.id}
          type="button"
          onClick={() => {
            setActiveTab(entry.id);
            if (layout.isCollapsed(entry.id)) layout.toggleCollapsed(entry.id);
          }}
          className={cn(
            'flex-1 px-2 h-7 max-lg:h-10 text-micro font-display font-semibold uppercase tracking-wider truncate transition-colors',
            entry.id === activeEntry.id
              ? 'text-ink border-b-2 border-accent bg-accent-soft/30'
              : 'text-ink-faint hover:text-ink hover:bg-surface-hover'
          )}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );

  if (isGrowExpanded) {
    return (
      <div className="flex-1 min-h-[220px] flex flex-col border-b border-hairline">
        {tabBar}
        <div className="flex-1 min-h-0 overflow-y-auto">{activeEntry.content}</div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col border-b border-hairline', 'shrink-0')}>
      {tabBar}
      <div
        style={{ maxHeight: collapsed ? 0 : (height ?? FALLBACK_HEIGHT), transition: 'max-height 200ms ease' }}
        className="overflow-y-auto"
      >
        {activeEntry.content}
      </div>
    </div>
  );
}
