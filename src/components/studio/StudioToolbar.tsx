import { ArrowLeft, Maximize2, PanelRight } from 'lucide-react';
import { IconButton } from '../ui';

interface StudioToolbarProps {
  chapterName: string;
  showCleaned: boolean;
  onToggleCleaned: () => void;
  onFit: () => void;
  onBack: () => void;
  onToggleDock: () => void;
  hasCleaned: boolean;
}

export function StudioToolbar({
  chapterName, showCleaned, onToggleCleaned,
  onFit, onBack, onToggleDock, hasCleaned,
}: StudioToolbarProps) {
  return (
    <div className="liquid-glass-bar flex items-center gap-2 px-2.5 sm:px-4 h-12 shrink-0 border-b border-hairline overflow-x-auto">
      <IconButton size="sm" aria-label="Back to pages" onClick={onBack} className="!bg-transparent !border-0 shrink-0">
        <ArrowLeft size={16} />
      </IconButton>

      <span className="hidden md:inline text-sm font-display font-semibold text-ink truncate max-w-[14rem] shrink-0">
        {chapterName}
      </span>

      <div className="w-px h-6 bg-hairline mx-1 shrink-0 hidden sm:block" />

      <button
        onClick={onToggleCleaned}
        disabled={!hasCleaned}
        className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-lg border border-hairline bg-ink/5 text-xs font-medium text-ink disabled:opacity-40 disabled:pointer-events-none hover:bg-ink/10 transition-colors"
      >
        <span className={showCleaned ? 'text-ink-faint' : 'text-accent'}>Original</span>
        <span className="text-ink-faint">/</span>
        <span className={showCleaned ? 'text-accent' : 'text-ink-faint'}>Cleaned</span>
      </button>

      <div className="flex-1" />

      <IconButton size="sm" aria-label="Fit to screen" onClick={onFit} className="!bg-transparent shrink-0">
        <Maximize2 size={15} />
      </IconButton>
      <IconButton size="sm" aria-label="Toggle layers & pages panel" onClick={onToggleDock} className="!bg-transparent shrink-0">
        <PanelRight size={15} />
      </IconButton>
    </div>
  );
}
