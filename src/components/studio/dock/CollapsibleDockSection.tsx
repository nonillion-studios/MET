import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../ui/cn';

interface CollapsibleDockSectionProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Grows to fill the column's free height while expanded; collapses to just its header row. */
  className?: string;
}

/**
 * A pinned section of the right column (Color, Layers) that's always present — collapsing it via
 * the chevron never fully hides it, only shrinks it back to its header, which is what lets the
 * other pinned section (and the swappable tab strip between them) grow into the freed space.
 */
export function CollapsibleDockSection({ title, collapsed, onToggle, children, className }: CollapsibleDockSectionProps) {
  return (
    <div className={cn('studio-panel flex flex-col min-h-0', collapsed ? 'shrink-0' : 'flex-1', className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="studio-interactive studio-focusable w-full flex items-center justify-between h-8 shrink-0 px-2.5 border-b border-hairline text-micro font-medium text-ink-faint hover:text-ink"
      >
        <span className="uppercase tracking-wide">{title}</span>
        {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
      </button>
      {!collapsed && <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>}
    </div>
  );
}
