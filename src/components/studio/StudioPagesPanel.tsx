import { CheckCircle2, Circle, Plus } from 'lucide-react';
import type { Page } from '../../types';
import { cn } from '../ui/cn';
import { IconButton } from '../ui';

interface StudioPagesPanelProps {
  pages: Page[];
  activePageId: string | null;
  onSelect: (pageId: string) => void;
  orientation: 'vertical' | 'horizontal';
  onManagePages?: () => void;
}

export function StudioPagesPanel({ pages, activePageId, onSelect, orientation, onManagePages }: StudioPagesPanelProps) {
  if (pages.length === 0) {
    return (
      <div
        className={cn(
          'liquid-glass-bar shrink-0 flex flex-col items-center justify-center gap-2 text-center p-3',
          orientation === 'vertical' ? 'w-32 sm:w-36 h-full border-r border-hairline' : 'w-full h-24 border-t border-hairline'
        )}
      >
        <p className="text-micro text-ink-faint">No pages yet</p>
        {onManagePages && (
          <IconButton size="sm" aria-label="Add pages" title="Add Pages" onClick={onManagePages}>
            <Plus size={14} />
          </IconButton>
        )}
      </div>
    );
  }
  return (
    <div
      className={cn(
        'liquid-glass-bar shrink-0 overflow-auto',
        orientation === 'vertical'
          ? 'w-32 sm:w-36 h-full border-r border-hairline flex flex-col gap-2 p-2.5'
          : 'w-full h-24 border-t border-hairline flex flex-row gap-2 p-2 items-center'
      )}
    >
      {onManagePages && (
        <IconButton
          size="sm"
          aria-label="Add pages"
          title="Add Pages"
          onClick={onManagePages}
          className={orientation === 'vertical' ? 'w-full aspect-[2/3] !h-auto shrink-0' : 'h-full aspect-[2/3] shrink-0'}
        >
          <Plus size={16} />
        </IconButton>
      )}
      {pages.map((page, index) => {
        const active = page.id === activePageId;
        return (
          <button
            key={page.id}
            onClick={() => onSelect(page.id)}
            className={cn(
              'relative rounded-control overflow-hidden border-2 shrink-0 transition-all',
              orientation === 'vertical' ? 'w-full aspect-[2/3]' : 'h-full aspect-[2/3]',
              active ? 'border-accent shadow-[0_0_0_3px_var(--color-accent-soft)]' : 'border-hairline hover:border-accent/40'
            )}
          >
            <img src={page.original.dataUrl} alt={page.original.filename} className="w-full h-full object-cover" draggable={false} />
            <span className="absolute top-1 left-1 px-1 rounded bg-black/60 text-white text-[9px] font-mono leading-tight">
              {index + 1}
            </span>
            <span className="absolute bottom-1 right-1">
              {page.cleaned
                ? <CheckCircle2 size={12} className="text-success drop-shadow" />
                : <Circle size={12} className="text-white/50 drop-shadow" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
