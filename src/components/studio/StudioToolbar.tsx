import { ArrowLeft, Maximize2, Minimize2, PanelRight } from 'lucide-react';
import { IconButton } from '../ui';
import type { WorkflowStage } from './WorkflowBar';

interface StudioToolbarProps {
  chapterName: string;
  showCleaned: boolean;
  onToggleCleaned: () => void;
  overlayOpacity: number;
  onOverlayOpacityChange: (opacity: number) => void;
  onFit: () => void;
  onBack: () => void;
  onToggleDock: () => void;
  hasCleaned: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Chapter → Page → ... → Export pipeline pills, folded into this same row to cut down on
   *  stacked chrome bars above the canvas — see WorkflowBar.tsx for what each stage means. */
  workflowStages: WorkflowStage[];
}

export function StudioToolbar({
  chapterName, showCleaned, onToggleCleaned, overlayOpacity, onOverlayOpacityChange,
  onFit, onBack, onToggleDock, hasCleaned, isFullscreen, onToggleFullscreen, workflowStages,
}: StudioToolbarProps) {
  return (
    <div className="liquid-glass-bar flex items-center gap-2 px-2.5 sm:px-4 h-12 shrink-0 border-b border-hairline">
      <IconButton size="sm" aria-label="Back to pages" onClick={onBack} className="!bg-transparent !border-0 shrink-0">
        <ArrowLeft size={16} />
      </IconButton>

      <span className="hidden md:inline text-title font-display font-semibold text-ink truncate max-w-[10rem] shrink-0">
        {chapterName}
      </span>

      <div className="w-px h-6 bg-hairline mx-1 shrink-0 hidden sm:block" />

      <button
        onClick={onToggleCleaned}
        disabled={!hasCleaned}
        className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-control border border-hairline bg-ink/5 text-ui font-medium text-ink disabled:opacity-40 disabled:pointer-events-none hover:bg-ink/10 transition-colors"
      >
        <span className={showCleaned ? 'text-ink-faint' : 'text-accent'}>Original</span>
        <span className="text-ink-faint">/</span>
        <span className={showCleaned ? 'text-accent' : 'text-ink-faint'}>Cleaned</span>
      </button>

      {hasCleaned && showCleaned && (
        <div className="hidden xl:flex items-center gap-1.5 shrink-0 pl-1" title="Blend the original page as an overlay above the cleaned page">
          <span className="text-micro text-ink-faint uppercase tracking-wide">Overlay</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={overlayOpacity}
            onChange={(e) => onOverlayOpacityChange(Number(e.target.value))}
            className="w-16 accent-accent"
            aria-label="Original page overlay opacity"
          />
        </div>
      )}

      <div className="w-px h-6 bg-hairline mx-1 shrink-0 hidden lg:block" />

      <div className="hidden lg:flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
        {workflowStages.map((stage, i) => (
          <div key={stage.id} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="text-ink-faint/30 text-micro px-0.5">›</span>}
            <span
              className={`px-2 py-0.5 rounded-full text-micro font-medium whitespace-nowrap transition-colors ${
                !stage.tracked
                  ? 'text-ink-faint/40'
                  : stage.active
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-faint'
              }`}
            >
              {stage.label}
            </span>
          </div>
        ))}
      </div>
      <div className="flex-1 lg:hidden" />

      <IconButton size="sm" aria-label="Fit to screen" onClick={onFit} className="!bg-transparent shrink-0">
        <Maximize2 size={15} />
      </IconButton>
      <IconButton
        size="sm"
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={isFullscreen ? 'Exit fullscreen (Ctrl/Cmd+Shift+F)' : 'Fullscreen (Ctrl/Cmd+Shift+F)'}
        onClick={onToggleFullscreen}
        className={`!bg-transparent shrink-0 ${isFullscreen ? '!text-accent' : ''}`}
      >
        {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </IconButton>
      <IconButton size="sm" aria-label="Toggle layers & pages panel" onClick={onToggleDock} className="!bg-transparent shrink-0">
        <PanelRight size={15} />
      </IconButton>
    </div>
  );
}
