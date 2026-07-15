import { Plus } from 'lucide-react';
import { NAV_TABS, type NavTab, type NavTabId } from '../config/navTabs';

interface BottomTabBarProps {
  activeTab: NavTabId;
  onTabChange: (id: NavTabId) => void;
  onCreatePress: () => void;
}

function TabButton({ tab, active, onClick }: { tab: NavTab; active: boolean; onClick: () => void }) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-all group ${active ? 'text-accent scale-105 font-bold' : 'text-ink-muted hover:text-ink'}`}
    >
      <div
        className={`p-1.5 rounded-xl transition-all ${
          active ? 'bg-accent-soft shadow-[0_0_14px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]' : 'group-hover:bg-ink/8'
        }`}
      >
        <Icon size={19} strokeWidth={1.8} />
      </div>
    </button>
  );
}

export function BottomTabBar({ activeTab, onTabChange, onCreatePress }: BottomTabBarProps) {
  const left = NAV_TABS.slice(0, 2);
  const right = NAV_TABS.slice(2);

  return (
    <div className="lg:hidden fixed bottom-safe left-1/2 -translate-x-1/2 z-50 flex justify-center">
      <div className="liquid-glass-nav relative px-4 xs:px-5 sm:px-6 py-2.5 rounded-[28px] flex items-center justify-center gap-4 xs:gap-5 sm:gap-6 transition-all">
        {left.map(tab => (
          <TabButton key={tab.id} tab={tab} active={activeTab === tab.id} onClick={() => onTabChange(tab.id)} />
        ))}

        <div className="relative -mt-7 shrink-0">
          <button
            type="button"
            onClick={onCreatePress}
            className="w-14 h-14 bg-accent rounded-full flex items-center justify-center shadow-[0_6px_24px_color-mix(in_srgb,var(--color-accent)_65%,transparent)] ring-1 ring-white/25 cursor-pointer text-white hover:scale-110 active:scale-95 transition-all duration-300"
            aria-label="Create"
          >
            <Plus size={26} strokeWidth={2.6} />
          </button>
        </div>

        {right.map(tab => (
          <TabButton key={tab.id} tab={tab} active={activeTab === tab.id} onClick={() => onTabChange(tab.id)} />
        ))}
      </div>
    </div>
  );
}
