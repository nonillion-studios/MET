import { useState } from 'react';
import { Eraser, Languages, Type, Palette, Play, Loader2, Braces } from 'lucide-react';
import { Modal, Button } from '../../ui';
import type { Page } from '../../../types';
import type { StudioLayer } from '../studioTypes';
import { InpaintStagePanel } from './InpaintStagePanel';
import { TranslateStagePanel } from './TranslateStagePanel';
import { TypesetStagePanel } from './TypesetStagePanel';
import { ColorStagePanel } from './ColorStagePanel';
import { JsonHandoffPanel } from './JsonHandoffPanel';
import { TextEditorSyncModal } from './TextEditorSyncModal';
import {
  defaultColorStageConfig, defaultTranslateStageConfig, defaultTypesetStageConfig,
  type AutomationConfig, type AutomationRunState, type InpaintStageConfig,
} from './automationTypes';
import { AUTOMATION_DEFAULT_INPAINT_PROMPT, AUTOMATION_DEFAULT_INPAINT_MODEL } from '../../../lib/aiInpaint';
import type { DetectBubbleBoundsFn } from './autoTypeset';
import type { AiProvider } from '../../../lib/aiTranslate';

type StageKey = 'inpaint' | 'translate' | 'typeset' | 'color' | 'jsonHandoff' | 'run';

const STAGES: { key: StageKey; label: string; icon: typeof Eraser }[] = [
  { key: 'inpaint', label: 'Inpainting', icon: Eraser },
  { key: 'translate', label: 'Translation', icon: Languages },
  { key: 'typeset', label: 'Typesetting', icon: Type },
  { key: 'color', label: 'Coloring', icon: Palette },
  { key: 'jsonHandoff', label: 'JSON Hand-off', icon: Braces },
  { key: 'run', label: 'Run', icon: Play },
];

const STAGE_LABEL: Record<'inpaint' | 'translate' | 'typeset' | 'color', string> = {
  inpaint: 'Inpainting', translate: 'Translating', typeset: 'Typesetting', color: 'Coloring',
};

interface AutomationModalProps {
  open: boolean;
  onClose: () => void;
  pages: Page[];
  layersByPage: Record<string, StudioLayer[]>;
  hasGeminiKey: boolean;
  activeProvider: AiProvider;
  onOpenSettings: () => void;
  activePageId: string | null;
  onJumpToPage: (pageId: string) => void;
  runState: AutomationRunState | null;
  onStart: (config: AutomationConfig) => void;
  onResume: () => void;
  onStop: () => void;
  onDismiss: () => void;
  onInsertTextLayers: (pageId: string, layers: StudioLayer[]) => void;
  detectBubbleBounds: DetectBubbleBoundsFn;
  customFontFamilies: string[];
  onCustomFontFamiliesChange: (families: string[]) => void;
}

export function AutomationModal({
  open, onClose, pages, layersByPage, hasGeminiKey, activeProvider, onOpenSettings, activePageId, onJumpToPage,
  runState, onStart, onResume, onStop, onDismiss, onInsertTextLayers, detectBubbleBounds,
  customFontFamilies, onCustomFontFamiliesChange,
}: AutomationModalProps) {
  const [stage, setStage] = useState<StageKey>('inpaint');
  const [inpaint, setInpaint] = useState<InpaintStageConfig>({
    branch: 'gemini',
    geminiPrompt: AUTOMATION_DEFAULT_INPAINT_PROMPT,
    model: AUTOMATION_DEFAULT_INPAINT_MODEL,
    pageIds: pages.map(p => p.id),
  });
  const [translate, setTranslate] = useState(defaultTranslateStageConfig);
  const [typeset, setTypeset] = useState(defaultTypesetStageConfig);
  const [color, setColor] = useState(defaultColorStageConfig);
  const [textEditorSyncOpen, setTextEditorSyncOpen] = useState(false);

  function handleTextEditorSyncConfirm(pageParagraphs: Record<string, string[]>) {
    setTranslate(prev => ({ ...prev, enabled: true, branch: 'text-editor', pageParagraphs }));
    setTextEditorSyncOpen(false);
  }

  const running = runState?.status === 'running';
  // Gemini is only actually needed when some stage in this run will call it — "already inpainted"
  // runs can start key-free as long as Translation/Coloring aren't also set to call Gemini.
  const usesGemini = inpaint.branch === 'gemini'
    || (translate.enabled && (translate.branch === 'gemini' || translate.branch === 'text-editor'))
    || (color.enabled && color.branch === 'gemini');
  const inpaintReady = inpaint.branch === 'gemini' || inpaint.branch === 'manual-verify';
  const canRun = inpaintReady && inpaint.pageIds.length > 0 && (!usesGemini || hasGeminiKey);

  function handleClose() {
    if (running) return; // Run dialog stays non-dismissible while a run is actively going.
    onClose();
  }

  function handleStart() {
    onStart({ inpaint, translate, typeset, color });
  }

  return (
    <>
    <Modal open={open} onClose={handleClose} title="Automation" size="xl" dismissible={!running}>
      <div className="flex gap-5 min-h-[24rem]">
        <div className="flex flex-col gap-1 w-40 shrink-0 border-r border-hairline pr-4">
          {STAGES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setStage(key)}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-control text-ui text-left transition-colors ${
                stage === key ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-ink/5'
              }`}
            >
              <Icon size={14} />
              <span className="flex-1">{label}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0">
          {stage === 'inpaint' && (
            <InpaintStagePanel
              pages={pages}
              layersByPage={layersByPage}
              config={inpaint}
              onChange={setInpaint}
              hasGeminiKey={hasGeminiKey}
              onOpenSettings={onOpenSettings}
              onJumpToPage={onJumpToPage}
            />
          )}

          {stage === 'translate' && (
            <TranslateStagePanel
              config={translate}
              onChange={setTranslate}
              onOpenTextEditorSync={() => setTextEditorSyncOpen(true)}
              activeProvider={activeProvider}
              onOpenSettings={onOpenSettings}
            />
          )}
          {stage === 'typeset' && (
            <TypesetStagePanel
              config={typeset}
              onChange={setTypeset}
              translateEnabled={translate.enabled}
              customFontFamilies={customFontFamilies}
              onCustomFontFamiliesChange={onCustomFontFamiliesChange}
            />
          )}
          {stage === 'color' && <ColorStagePanel config={color} onChange={setColor} />}
          {stage === 'jsonHandoff' && (
            <JsonHandoffPanel
              pages={pages}
              layersByPage={layersByPage}
              activePageId={activePageId}
              onJumpToPage={onJumpToPage}
              onInsertTextLayers={onInsertTextLayers}
              detectBubbleBounds={detectBubbleBounds}
              typesetStyle={typeset}
            />
          )}

          {stage === 'run' && (
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="font-display text-ui font-semibold text-ink mb-1">Run</h3>
                <p className="text-micro text-ink-faint">
                  {inpaintReady
                    ? [
                        'Automation will work through each selected page in order:',
                        inpaint.branch === 'gemini' ? 'inpaint' : 'skip inpaint (already inpainted)',
                        translate.enabled && (translate.branch === 'gemini' || translate.branch === 'text-editor') ? '→ translate' : '',
                        typeset.enabled && translate.enabled ? '→ typeset' : '',
                        color.enabled && color.branch === 'gemini' ? '→ color' : '',
                      ].filter(Boolean).join(' ')
                    : 'Pick "Gemini API" or "I\'ve already inpainted these" under Inpainting to start a run.'}
                </p>
              </div>

              {runState && runState.status !== 'idle' && (
                <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto rounded-control border border-hairline p-2">
                  {runState.config.inpaint.pageIds.map((pageId, i) => {
                    const page = pages.find(p => p.id === pageId);
                    const pageState = runState.perPage[pageId];
                    const isCurrent = i === runState.currentPageIndex && pageState?.status === 'processing';
                    return (
                      <div key={pageId} className="flex items-center justify-between gap-2 px-1.5 py-1 text-micro">
                        <span className="text-ink truncate">{i + 1}. {page?.original.filename ?? pageId}</span>
                        <span className={
                          pageState?.status === 'error' ? 'text-danger'
                            : pageState?.status === 'done' ? 'text-success'
                              : pageState?.status === 'processing' ? 'text-accent flex items-center gap-1'
                                : 'text-ink-faint'
                        }>
                          {isCurrent && <Loader2 size={11} className="animate-spin" />}
                          {isCurrent ? STAGE_LABEL[runState.currentStage] : (pageState?.status ?? 'pending')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-2">
                {runState?.status === 'paused' ? (
                  <>
                    <Button onClick={onResume}>Resume</Button>
                    <Button variant="secondary" onClick={onDismiss}>Discard run</Button>
                  </>
                ) : runState?.status === 'running' ? (
                  <Button variant="danger" onClick={onStop}>Stop</Button>
                ) : (
                  <Button disabled={!canRun} onClick={handleStart}>
                    <Play size={14} /> Start Automation
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
    <TextEditorSyncModal
      open={textEditorSyncOpen}
      onClose={() => setTextEditorSyncOpen(false)}
      pages={pages}
      onConfirm={handleTextEditorSyncConfirm}
    />
    </>
  );
}
