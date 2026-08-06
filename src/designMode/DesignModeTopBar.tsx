import { useEffect, useRef, useState } from 'react';
import { FilePlus2, ImagePlus, Download, Undo2, Redo2, Maximize, Minimize, ChevronDown } from 'lucide-react';
import { IconButton, Button } from '../components/ui';
import type { DesignImage } from './designModeStore';

export type DesignExportFormat = 'png' | 'jpg' | 'webp' | 'psd';

interface DesignModeTopBarProps {
  activeImage: DesignImage | null;
  hasUnsavedChanges: boolean;
  onRenameActiveImage: (name: string) => void;
  onNewCanvas: () => void;
  onAddImage: () => void;
  onExport: (format: DesignExportFormat) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoomPercent: number;
  onFitZoom: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

const EXPORT_FORMATS: { id: DesignExportFormat; label: string }[] = [
  { id: 'png', label: 'PNG' },
  { id: 'jpg', label: 'JPG' },
  { id: 'webp', label: 'WEBP' },
  { id: 'psd', label: 'PSD' },
];

/**
 * Design Mode's own top bar — no workflow bar (Chapter > Page > Detection > ... is Studio-specific
 * and doesn't apply to a free-form canvas). Sits below the app's global TopBar/sidebar, same as
 * Studio's own internal chrome does.
 */
export function DesignModeTopBar({
  activeImage, hasUnsavedChanges, onRenameActiveImage, onNewCanvas, onAddImage, onExport,
  canUndo, canRedo, onUndo, onRedo, zoomPercent, onFitZoom, isFullscreen, onToggleFullscreen,
}: DesignModeTopBarProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [exportOpen]);

  const startRename = () => {
    if (!activeImage) return;
    setTitleDraft(activeImage.name);
    setEditingTitle(true);
  };

  const commitRename = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && activeImage && trimmed !== activeImage.name) onRenameActiveImage(trimmed);
  };

  return (
    <div className="liquid-glass-bar w-full h-12 shrink-0 border-b border-hairline px-3 flex items-center justify-between gap-3 z-20">
      {/* Left: document title + unsaved indicator */}
      <div className="flex items-center gap-2 min-w-0">
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditingTitle(false);
            }}
            className="text-sm font-semibold bg-ink/5 border border-hairline rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-accent min-w-0 max-w-[16rem]"
          />
        ) : (
          <button
            type="button"
            onClick={startRename}
            disabled={!activeImage}
            className="text-sm font-semibold text-ink truncate max-w-[16rem] hover:text-accent transition-colors disabled:hover:text-ink disabled:cursor-default text-left"
          >
            {activeImage?.name ?? 'Design Mode'}
          </button>
        )}
        {hasUnsavedChanges && activeImage && (
          <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-label="Unsaved changes" />
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Button variant="secondary" size="sm" onClick={onNewCanvas}>
          <FilePlus2 size={14} /> New Canvas
        </Button>
        <Button variant="primary" size="sm" onClick={onAddImage} disabled={!activeImage}>
          <ImagePlus size={14} /> Add Image
        </Button>

        <div className="relative" ref={exportMenuRef}>
          <Button variant="secondary" size="sm" onClick={() => setExportOpen(v => !v)} disabled={!activeImage}>
            <Download size={14} /> Export <ChevronDown size={12} />
          </Button>
          {exportOpen && (
            <div className="absolute right-0 top-full mt-1 w-32 bg-[var(--color-surface)] border border-hairline rounded-lg shadow-lg overflow-hidden z-30">
              {EXPORT_FORMATS.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { setExportOpen(false); onExport(f.id); }}
                  className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-accent-soft hover:text-accent transition-colors"
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 bg-ink/5 border border-hairline rounded-full p-1 ml-1">
          <IconButton size="sm" aria-label="Undo" onClick={onUndo} disabled={!canUndo} className="!bg-transparent !border-0">
            <Undo2 size={15} />
          </IconButton>
          <IconButton size="sm" aria-label="Redo" onClick={onRedo} disabled={!canRedo} className="!bg-transparent !border-0">
            <Redo2 size={15} />
          </IconButton>
        </div>

        <button
          type="button"
          onClick={onFitZoom}
          className="text-xs text-ink-muted hover:text-ink px-2 h-8 rounded-md hover:bg-ink/5 transition-colors tabular-nums"
        >
          {Math.round(zoomPercent)}%
        </button>

        <IconButton
          size="sm"
          aria-label={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          onClick={onToggleFullscreen}
          className="!bg-transparent !border-0"
        >
          {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
        </IconButton>
      </div>
    </div>
  );
}
