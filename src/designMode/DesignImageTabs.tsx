import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { DesignImage } from './designModeStore';

interface DesignImageTabsProps {
  images: DesignImage[];
  activeImageId: string | null;
  onSelect: (imageId: string) => void;
  onRename: (imageId: string, name: string) => void;
  onClose: (imageId: string) => void;
  onNewCanvas: () => void;
}

/**
 * One tab per open canvas (Section 5). Reorder-by-drag and drag-a-layer-onto-a-tab are explicitly
 * deferred (flagged in the plan, not silently dropped) — this covers create/switch/rename/close.
 * Closing a tab doesn't prompt to discard changes: with no persistence-dirty-tracking wired yet
 * (that lands in Section 6 alongside the paint-canvas registry), there's no real saved/unsaved
 * distinction to prompt about — everything only ever lived in memory so far.
 */
export function DesignImageTabs({ images, activeImageId, onSelect, onRename, onClose, onNewCanvas }: DesignImageTabsProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  if (images.length === 0) return null;

  const startRename = (img: DesignImage) => {
    setRenamingId(img.id);
    setRenameDraft(img.name);
  };

  const commitRename = (imageId: string) => {
    setRenamingId(null);
    const trimmed = renameDraft.trim();
    if (trimmed) onRename(imageId, trimmed);
  };

  return (
    <div className="flex items-center gap-1 h-10 shrink-0 border-b border-hairline px-2 overflow-x-auto bg-ink/[0.02]">
      {images.map(img => {
        const active = img.id === activeImageId;
        return (
          <div
            key={img.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(img.id)}
            className={`group flex items-center gap-2 h-8 pl-1.5 pr-2 rounded-md shrink-0 cursor-pointer transition-colors ${
              active ? 'bg-[var(--color-surface)] border border-hairline shadow-sm' : 'hover:bg-ink/5'
            }`}
          >
            <div className="w-10 h-[30px] rounded-sm overflow-hidden shrink-0 border border-hairline/60 bg-[repeating-conic-gradient(#d1d5db_0_25%,#e5e7eb_0_50%)] bg-[length:8px_8px]">
              {img.thumbnail && <img src={img.thumbnail} alt="" className="w-full h-full object-cover" draggable={false} />}
            </div>

            {renamingId === img.id ? (
              <input
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => commitRename(img.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(img.id);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                className="text-xs bg-transparent border-b border-accent outline-none w-24"
              />
            ) : (
              <span
                onDoubleClick={(e) => { e.stopPropagation(); startRename(img); }}
                className="text-xs text-ink truncate max-w-[7.5rem]"
                title={img.name}
              >
                {img.name}
              </span>
            )}

            <button
              type="button"
              aria-label={`Close ${img.name}`}
              onClick={(e) => { e.stopPropagation(); onClose(img.id); }}
              className="w-4 h-4 rounded flex items-center justify-center text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-ink/10 hover:text-ink transition-opacity shrink-0"
            >
              <X size={11} />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        aria-label="New Canvas"
        onClick={onNewCanvas}
        className="w-7 h-7 rounded-md flex items-center justify-center text-ink-muted hover:bg-ink/5 hover:text-ink transition-colors shrink-0 ml-1"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
