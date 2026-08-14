import { useMemo } from 'react';
import { Sparkles, PenLine, CheckCircle2, AlertTriangle, Key } from 'lucide-react';
import type { Page } from '../../../types';
import type { StudioLayer } from '../studioTypes';
import type { InpaintBranch, InpaintStageConfig } from './automationTypes';
import { AUTOMATION_DEFAULT_INPAINT_PROMPT } from '../../../lib/aiInpaint';

interface InpaintStagePanelProps {
  pages: Page[];
  layersByPage: Record<string, StudioLayer[]>;
  config: InpaintStageConfig;
  onChange: (config: InpaintStageConfig) => void;
  hasGeminiKey: boolean;
  onOpenSettings: () => void;
  onJumpToPage: (pageId: string) => void;
}

const BRANCHES: { id: InpaintBranch; label: string; icon: typeof Sparkles; disabled?: boolean }[] = [
  { id: 'gemini', label: 'Gemini API', icon: Sparkles },
  { id: 'custom', label: 'Custom', icon: PenLine, disabled: true },
  { id: 'manual-verify', label: "I've already inpainted these", icon: CheckCircle2 },
];

/** A page counts as "registered" if it has a clean-patch layer (already page-sized by
 *  construction) or a placed-image layer whose axis-aligned bounds cover most of the page — a
 *  lightweight registration sanity check, not pixel-diffing, per the plan's explicit scope. */
export function checkPageRegistered(layers: StudioLayer[], page: Page): boolean {
  const pageArea = page.original.width * page.original.height;
  for (const layer of layers) {
    if (layer.type === 'clean-patch') return true;
    if (layer.type === 'placed-image' && layer.placedImage) {
      const { naturalWidth, naturalHeight, scaleX, scaleY } = layer.placedImage;
      const area = Math.abs(naturalWidth * scaleX) * Math.abs(naturalHeight * scaleY);
      if (area >= pageArea * 0.9) return true;
    }
  }
  return false;
}

export function InpaintStagePanel({ pages, layersByPage, config, onChange, hasGeminiKey, onOpenSettings, onJumpToPage }: InpaintStagePanelProps) {
  const registration = useMemo(
    () => pages.map(page => ({ page, registered: checkPageRegistered(layersByPage[page.id] ?? [], page) })),
    [pages, layersByPage],
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-display text-ui font-semibold text-ink mb-1">Inpainting</h3>
        <p className="text-micro text-ink-faint">Remove foreign-language text before typesetting the translation.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {BRANCHES.map(({ id, label, icon: Icon, disabled }) => (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...config, branch: id })}
            className={`flex flex-col items-start gap-1.5 p-3 rounded-control border text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              config.branch === id ? 'border-accent bg-accent-soft' : 'border-hairline hover:bg-ink/5'
            }`}
          >
            <Icon size={16} className={config.branch === id ? 'text-accent' : 'text-ink-faint'} />
            <span className="text-ui font-medium text-ink">{label}</span>
            {disabled && <span className="text-micro text-ink-faint">Coming soon</span>}
          </button>
        ))}
      </div>

      {config.branch === 'gemini' && (
        <div className="flex flex-col gap-3">
          {!hasGeminiKey && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center gap-2 px-3 py-2 rounded-control border border-warning/40 bg-warning/10 text-ui text-ink hover:bg-warning/15 transition-colors text-left"
            >
              <Key size={14} className="text-warning shrink-0" />
              No Gemini API key configured — open Settings to add one.
            </button>
          )}
          <label className="flex flex-col gap-1 text-micro text-ink-faint">
            <span>Prompt</span>
            <textarea
              value={config.geminiPrompt}
              onChange={(e) => onChange({ ...config, geminiPrompt: e.target.value })}
              placeholder={AUTOMATION_DEFAULT_INPAINT_PROMPT}
              rows={4}
              className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2.5 py-2 text-ink text-ui resize-none"
            />
          </label>
          <p className="text-micro text-ink-faint">
            {config.pageIds.length} of {pages.length} page{pages.length === 1 ? '' : 's'} selected for this run.
          </p>
        </div>
      )}

      {config.branch === 'manual-verify' && (
        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          {registration.map(({ page, registered }) => (
            <button
              key={page.id}
              type="button"
              onClick={() => onJumpToPage(page.id)}
              className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-control border border-hairline hover:bg-ink/5 transition-colors text-left"
            >
              <span className="text-ui text-ink truncate">{page.original.filename || page.id}</span>
              {registered
                ? <span className="flex items-center gap-1 text-micro text-success shrink-0"><CheckCircle2 size={13} /> Registered</span>
                : <span className="flex items-center gap-1 text-micro text-warning shrink-0"><AlertTriangle size={13} /> Missing or misaligned</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
