import { Sparkles, FileText, PenLine, FolderSync, Settings as SettingsIcon } from 'lucide-react';
import type { TranslateBranch, TranslateStageConfig } from './automationTypes';
import { Switch, Button } from '../../ui';
import { AI_PROVIDERS, type AiProvider } from '../../../lib/aiTranslate';

interface TranslateStagePanelProps {
  config: TranslateStageConfig;
  onChange: (config: TranslateStageConfig) => void;
  /** Opens TextEditorSyncModal — picks a Text Editor document and lets the user assign each of its
   *  own pages to a Studio page. */
  onOpenTextEditorSync: () => void;
  /** Which provider Settings currently has configured — Translation always calls this one (see
   *  aiSettingsStore.ts's single global provider/key slot); this stage can only override the model. */
  activeProvider: AiProvider;
  onOpenSettings: () => void;
}

const BRANCHES: { id: TranslateBranch; label: string; icon: typeof Sparkles; disabled?: boolean }[] = [
  { id: 'gemini', label: 'AI Provider', icon: Sparkles },
  { id: 'text-editor', label: 'From Text Editor', icon: FileText },
  { id: 'custom', label: 'Custom', icon: PenLine, disabled: true },
];

export function TranslateStagePanel({ config, onChange, onOpenTextEditorSync, activeProvider, onOpenSettings }: TranslateStagePanelProps) {
  const providerInfo = AI_PROVIDERS.find(p => p.id === activeProvider);
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

          {config.branch === 'gemini' && (
            <div className="flex flex-col gap-3">
              <p className="text-micro text-ink-faint">Reads each page's bubbles/SFX and translates them — no manual work needed, runs as part of Start Automation.</p>
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex items-center gap-2 px-3 py-2 rounded-control border border-hairline hover:bg-ink/5 transition-colors text-left"
              >
                <SettingsIcon size={14} className="text-ink-faint shrink-0" />
                <span className="text-ui text-ink">Using <strong>{providerInfo?.label ?? activeProvider}</strong> (configured in Settings)</span>
              </button>
              <label className="flex flex-col gap-1 text-micro text-ink-faint">
                <span>Model (optional override)</span>
                <input
                  type="text"
                  value={config.model}
                  onChange={(e) => onChange({ ...config, model: e.target.value })}
                  placeholder={providerInfo?.defaultModel ?? 'Uses the model set in Settings'}
                  className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2.5 py-1.5 text-ink text-ui font-mono"
                />
              </label>
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

          {config.branch === 'text-editor' && (
            <div className="flex flex-col gap-3">
              <p className="text-micro text-ink-faint">
                Uses text you already translated in the Text Editor instead of translating again — the AI provider's
                only job here is finding *where* each already-translated line goes on the page (it's told not to
                translate or rewrite anything). Pick a document, then assign each of its pages to a Studio page.
                Runs as part of Start Automation, same as the AI Provider branch. Uses the same <strong>{providerInfo?.label ?? activeProvider}</strong> provider configured in Settings.
              </p>
              <Button variant="secondary" size="sm" onClick={onOpenTextEditorSync} className="self-start">
                <FolderSync size={13} /> Choose chapter &amp; sync pages
              </Button>
              {config.pageParagraphs && (
                <p className="text-micro text-success">
                  {Object.keys(config.pageParagraphs).length} page{Object.keys(config.pageParagraphs).length === 1 ? '' : 's'} synced.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
