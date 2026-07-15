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
    <div className={cn('studio-panel w-full shrink-0 h-full border-l border-hairline flex flex-col min-h-0', className)}>
      <div className="flex items-center h-10 shrink-0 border-b border-hairline gap-1 pr-1.5">
        {/* Tabs size to their label and scroll horizontally. They used to be `flex-1`,
            which divided the dock's width evenly across every open panel and squashed
            8 labels into unreadable stubs ("Ty… Tr… C… Fo…") at typical dock widths. */}
        <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto px-1.5 py-1.5">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
              className={cn(
                'studio-interactive studio-focusable shrink-0 h-7 rounded-control text-micro font-medium px-2.5 whitespace-nowrap',
                activeTab === tab.id
                  ? 'bg-accent-soft text-accent shadow-control'
                  : 'text-ink-faint hover:text-ink hover:bg-ink/10'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {onFloatTab && active && (
          <IconButton size="sm" aria-label={`Float ${active.label}`} title="Float this panel" onClick={() => onFloatTab(active.id)} className="studio-interactive !bg-transparent hover:!bg-ink/10 !w-6 !h-6 shrink-0">
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
