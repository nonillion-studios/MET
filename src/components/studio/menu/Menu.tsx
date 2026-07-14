import { Check } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { MenuDef } from './menuDefinitions';

interface MenuProps {
  menu: MenuDef;
  onItemClick: (action?: () => void) => void;
}

export function Menu({ menu, onItemClick }: MenuProps) {
  return (
    <div className="absolute top-full left-0 mt-1 z-50 liquid-glass-heavy rounded-xl border border-hairline py-1 min-w-[200px]">
      {menu.items.map(item => item.separator ? (
        <div key={item.id} className="h-px bg-hairline my-1 mx-2" />
      ) : (
        <button
          key={item.id}
          disabled={item.disabled}
          onClick={() => onItemClick(item.action)}
          className={cn(
            'w-full flex items-center justify-between gap-4 px-3 py-1.5 text-xs text-left transition-colors',
            'disabled:opacity-40 disabled:pointer-events-none',
            'text-ink hover:bg-accent-soft hover:text-accent'
          )}
        >
          <span className="flex items-center gap-1.5">
            <Check size={11} className={item.checked ? 'text-accent' : 'invisible'} />
            {item.label}
          </span>
          {item.shortcut && <span className="text-[10px] text-ink-faint font-mono">{item.shortcut}</span>}
        </button>
      ))}
    </div>
  );
}
