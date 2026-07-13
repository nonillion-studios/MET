import { useState, type ReactNode } from 'react';
import { PictureInPicture2 } from 'lucide-react';
import { cn } from '../ui/cn';
import { IconButton } from '../ui';

interface RightDockProps {
  tabs: { id: string; label: string; content: ReactNode }[];
  defaultTab?: string;
  className?: string;
  /** Controlled mode: when provided (with onTabChange), the dock no longer tracks its own tab state. */
  activeTab?: string;
  onTabChange?: (id: string) => void;
  /** When provided, shows a "float out" button for the active tab (desktop dock regions only). */
  onFloatTab?: (id: string) => void;
}

export function RightDock({ tabs, defaultTab, className, activeTab: activeTabProp, onTabChange, onFloatTab }: RightDockProps) {
  const [internalTab, setInternalTab] = useState(defaultTab ?? tabs[0]?.id);
  const activeTab = activeTabProp ?? internalTab;
  const setActiveTab = onTabChange ?? setInternalTab;
  const active = tabs.find(t => t.id === activeTab) ?? tabs[0];

  return (
    <div className={cn('liquid-glass-bar w-full shrink-0 h-full border-l border-hairline flex flex-col min-h-0', className)}>
      <div className="flex items-center h-10 shrink-0 border-b border-hairline px-1.5 gap-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-1 h-7 rounded-md text-[11px] font-medium transition-colors truncate px-1',
              activeTab === tab.id ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:text-ink hover:bg-ink/5'
            )}
          >
            {tab.label}
          </button>
        ))}
        {onFloatTab && active && (
          <IconButton size="sm" aria-label={`Float ${active.label}`} title="Float this panel" onClick={() => onFloatTab(active.id)} className="!bg-transparent !w-6 !h-6 shrink-0">
            <PictureInPicture2 size={12} />
          </IconButton>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {active?.content}
      </div>
    </div>
  );
}
