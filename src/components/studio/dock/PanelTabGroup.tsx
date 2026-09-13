import type { ReactNode } from 'react';
import { cn } from '../../ui/cn';

export interface PanelTabGroupMember {
  id: string;
  label: string;
  content: ReactNode;
}

interface PanelTabGroupProps {
  members: PanelTabGroupMember[];
  activeId: string;
  onTabChange: (id: string) => void;
}

/** The content of a `CollapsiblePanel` when two or more registry panels share a `group` (see
 *  `panelRegistry.ts`) and are all currently visible — a small tab strip switches between them
 *  inside the one shared header/collapse/resize/maximize chrome `CollapsiblePanel` already owns, so
 *  this component only ever renders the tab row + whichever member is active, nothing else. Kept
 *  deliberately subtle/compact per the "don't turn the sidebar into a dashboard" constraint — plain
 *  text tabs with an accent underline, no icons, no extra padding beyond the panel's own. */
export function PanelTabGroup({ members, activeId, onTabChange }: PanelTabGroupProps) {
  const active = members.find(m => m.id === activeId) ?? members[0];
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-2 pt-1 shrink-0 border-b border-hairline/70">
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onTabChange(m.id)}
            className={cn(
              'px-0.5 pb-1.5 text-micro border-b-2 -mb-px',
              m.id === active.id ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{active.content}</div>
    </div>
  );
}
