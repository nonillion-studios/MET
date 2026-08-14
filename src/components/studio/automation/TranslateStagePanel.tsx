import { Sparkles, FileText, PenLine } from 'lucide-react';
import type { TranslateBranch, TranslateStageConfig } from './automationTypes';
import { Switch } from '../../ui';

interface TranslateStagePanelProps {
  config: TranslateStageConfig;
  onChange: (config: TranslateStageConfig) => void;
}

const BRANCHES: { id: TranslateBranch; label: string; icon: typeof Sparkles; disabled?: boolean }[] = [
  { id: 'gemini', label: 'Gemini API', icon: Sparkles },
  { id: 'text-editor', label: 'From Text Editor', icon: FileText },
  { id: 'custom', label: 'Custom', icon: PenLine, disabled: true },
];

const BRANCH_DESCRIPTION: Record<'gemini' | 'text-editor', string> = {
  gemini: 'Reads the whole page at once, no continuity between pages.',
  'text-editor': "Same engine the Text Editor's own AI translation uses, page by page in chapter order — each page's prompt gets told it's page N of M, so dialogue/SFX that continues across a page break stays coherent.",
};

export function TranslateStagePanel({ config, onChange }: TranslateStagePanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-ui font-semibold text-ink mb-1">Translation</h3>
          <p className="text-micro text-ink-faint">Read every bubble/SFX and translate it, ready for Typesetting to place.</p>
        </div>
        <Switch checked={config.enabled} onChange={(enabled) => onChange({ ...config, enabled })} aria-label="Enable Translation stage" />
      </div>

      {config.enabled && (
        <>
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

          {(config.branch === 'gemini' || config.branch === 'text-editor') && (
            <div className="flex flex-col gap-3">
              <p className="text-micro text-ink-faint">{BRANCH_DESCRIPTION[config.branch]}</p>
              <label className="flex flex-col gap-1 text-micro text-ink-faint">
                <span>Target language</span>
                <input
                  type="text"
                  value={config.targetLanguage}
                  onChange={(e) => onChange({ ...config, targetLanguage: e.target.value })}
                  className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2.5 py-1.5 text-ink text-ui"
                />
              </label>
              <label className="flex flex-col gap-1 text-micro text-ink-faint">
                <span>Prompt (optional)</span>
                <textarea
                  value={config.prompt}
                  onChange={(e) => onChange({ ...config, prompt: e.target.value })}
                  placeholder="Tone, honorifics, character names…"
                  rows={3}
                  className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2.5 py-2 text-ink text-ui resize-none"
                />
              </label>
              <label className="flex items-center gap-2 text-ui text-ink">
                <input
                  type="checkbox"
                  checked={config.blackAndWhiteOnly}
                  onChange={(e) => onChange({ ...config, blackAndWhiteOnly: e.target.checked })}
                />
                This manga is black &amp; white — don't suggest color
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}
