import { Undo2, Redo2 } from 'lucide-react';
import { IconButton } from '../../ui';
import { cn } from '../../ui/cn';
import { useHistory } from './HistoryContext';

export function HistoryPanel() {
  const { entries, cursor, undo, redo, jumpTo, canUndo, canRedo } = useHistory();

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-hairline">
        <span className="text-xs font-display font-semibold text-ink-faint uppercase tracking-wide">History</span>
        <div className="flex items-center gap-1">
          <IconButton size="sm" aria-label="Undo" disabled={!canUndo} onClick={undo} className="!bg-transparent">
            <Undo2 size={13} />
          </IconButton>
          <IconButton size="sm" aria-label="Redo" disabled={!canRedo} onClick={redo} className="!bg-transparent">
            <Redo2 size={13} />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-1.5 px-1.5 flex flex-col gap-0.5">
        <button
          onClick={() => jumpTo(-1)}
          className={cn(
            'text-left px-2.5 py-1.5 rounded-md text-xs',
            cursor === -1 ? 'bg-accent-soft text-accent font-medium' : 'text-ink-faint hover:bg-ink/5'
          )}
        >
          Opened document
        </button>
        {entries.map((entry, i) => (
          <button
            key={i}
            onClick={() => jumpTo(i)}
            className={cn(
              'text-left px-2.5 py-1.5 rounded-md text-xs truncate',
              i === cursor ? 'bg-accent-soft text-accent font-medium' : 'text-ink-faint hover:bg-ink/5'
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}
