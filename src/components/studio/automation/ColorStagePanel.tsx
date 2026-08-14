import { Sparkles, PenLine } from 'lucide-react';
import { Switch } from '../../ui';
import type { ColorBranch, ColorPlacement, ColorStageConfig } from './automationTypes';
import { AUTOMATION_DEFAULT_COLOR_PROMPT } from '../../../lib/aiColor';

interface ColorStagePanelProps {
  config: ColorStageConfig;
  onChange: (config: ColorStageConfig) => void;
}

const BRANCHES: { id: ColorBranch; label: string; icon: typeof Sparkles; disabled?: boolean }[] = [
  { id: 'gemini', label: 'Gemini API', icon: Sparkles },
  { id: 'custom', label: 'Custom', icon: PenLine, disabled: true },
];

const PLACEMENTS: { id: ColorPlacement; label: string; description: string }[] = [
  { id: 'above-inpaint', label: 'Layer above inpaint', description: 'Adds the colorized page as a new layer on the same page.' },
  { id: 'new-page-beneath', label: 'New page beneath', description: 'Inserts the colorized result as a whole new page right after this one.' },
];

export function ColorStagePanel({ config, onChange }: ColorStagePanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-ui font-semibold text-ink mb-1">Coloring</h3>
          <p className="text-micro text-ink-faint">Colorizes the inpainted (text-removed) page — never the original with foreign text still on it.</p>
        </div>
        <Switch checked={config.enabled} onChange={(enabled) => onChange({ ...config, enabled })} aria-label="Enable Coloring stage" />
      </div>

      {config.enabled && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
            <>
              <label className="flex flex-col gap-1 text-micro text-ink-faint">
                <span>Prompt</span>
                <textarea
                  value={config.prompt}
                  onChange={(e) => onChange({ ...config, prompt: e.target.value })}
                  placeholder={AUTOMATION_DEFAULT_COLOR_PROMPT}
                  rows={3}
                  className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2.5 py-2 text-ink text-ui resize-none"
                />
              </label>
              <div className="flex flex-col gap-2">
                {PLACEMENTS.map(({ id, label, description }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onChange({ ...config, placement: id })}
                    className={`flex flex-col items-start gap-0.5 p-2.5 rounded-control border text-left transition-colors ${
                      config.placement === id ? 'border-accent bg-accent-soft' : 'border-hairline hover:bg-ink/5'
                    }`}
                  >
                    <span className="text-ui font-medium text-ink">{label}</span>
                    <span className="text-micro text-ink-faint">{description}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
