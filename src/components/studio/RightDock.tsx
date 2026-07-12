import { useState, type ReactNode } from 'react';
import { cn } from '../ui/cn';

interface RightDockProps {
  tabs: { id: string; label: string; content: ReactNode }[];
  defaultTab?: string;
  className?: string;
}

export function RightDock({ tabs, defaultTab, className }: RightDockProps) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.id);
  const active = tabs.find(t => t.id === activeTab) ?? tabs[0];

  return (
    <div className={cn('liquid-glass-bar w-64 shrink-0 h-full border-l border-hairline flex flex-col min-h-0', className)}>
      <div className="flex items-center h-10 shrink-0 border-b border-hairline px-1.5 gap-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-1 h-7 rounded-md text-[11px] font-medium transition-colors',
              activeTab === tab.id ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:text-ink hover:bg-ink/5'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {active?.content}
      </div>
    </div>
  );
}
