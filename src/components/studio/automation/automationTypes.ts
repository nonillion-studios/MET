/** Types for the Automation modal (StudioToolbar's "Automation" button) — the pipeline-builder
 *  wizard plus the run/resume state persisted while the simulated AI cursor works through pages.
 *  Each stage's Gemini branch is functional, as is Translation's "From Text Editor" branch (same
 *  call, continuity-aware prompt). Every stage's "Custom" branch stays a locked "coming soon" row
 *  in the wizard (see AutomationModal.tsx) until its own plan builds it. */

export type InpaintBranch = 'gemini' | 'custom' | 'manual-verify';

export interface InpaintStageConfig {
  branch: InpaintBranch;
  /** User-editable Gemini prompt; falls back to AUTOMATION_DEFAULT_INPAINT_PROMPT when blank. */
  geminiPrompt: string;
  /** Page ids this run covers, in run order. */
  pageIds: string[];
}

export type TranslateBranch = 'gemini' | 'text-editor' | 'custom';

export interface TranslateStageConfig {
  enabled: boolean;
  branch: TranslateBranch;
  prompt: string;
  targetLanguage: string;
  /** Tells Gemini to suggest no color info — the manga stays black & white; only relevant when the
   *  Coloring stage is off, but kept on this stage's config since it's a translation-time hint. */
  blackAndWhiteOnly: boolean;
}

/** No branch choice here — Typesetting always runs the same flood-fill-correct-and-autofit
 *  algorithm (autoTypeset.ts) right after Translation produces bubbles. Only style choices vary. */
export interface TypesetStageConfig {
  enabled: boolean;
  dialogueFontFamily: string;
  sfxFontFamily: string;
  color: string;
  strokeColor: string;
  strokeWidth: number;
}

export type ColorBranch = 'gemini' | 'custom';
export type ColorPlacement = 'above-inpaint' | 'new-page-beneath';

export interface ColorStageConfig {
  enabled: boolean;
  branch: ColorBranch;
  prompt: string;
  placement: ColorPlacement;
}

export interface AutomationConfig {
  inpaint: InpaintStageConfig;
  translate: TranslateStageConfig;
  typeset: TypesetStageConfig;
  color: ColorStageConfig;
}

export type AutomationPageStatus = 'pending' | 'processing' | 'done' | 'error' | 'needs-review';
export type AutomationStageKey = 'inpaint' | 'translate' | 'typeset' | 'color';

export interface AutomationPageState {
  status: AutomationPageStatus;
  error?: string;
}

export type AutomationRunStatus = 'idle' | 'running' | 'paused' | 'done';

export interface AutomationRunState {
  chapterId: string;
  config: AutomationConfig;
  status: AutomationRunStatus;
  currentPageIndex: number;
  /** Which stage of the per-page pipeline is active right now — drives the cursor HUD's label. */
  currentStage: AutomationStageKey;
  perPage: Record<string, AutomationPageState>;
  startedAt: number;
  elapsedMs: number;
}

export function createAutomationRunState(chapterId: string, config: AutomationConfig, startedAt: number): AutomationRunState {
  const perPage: Record<string, AutomationPageState> = {};
  for (const pageId of config.inpaint.pageIds) perPage[pageId] = { status: 'pending' };
  return { chapterId, config, status: 'running', currentPageIndex: 0, currentStage: 'inpaint', perPage, startedAt, elapsedMs: 0 };
}

export function defaultTranslateStageConfig(): TranslateStageConfig {
  return { enabled: false, branch: 'gemini', prompt: '', targetLanguage: 'English', blackAndWhiteOnly: true };
}

export function defaultTypesetStageConfig(): TypesetStageConfig {
  return { enabled: false, dialogueFontFamily: 'Anime Ace', sfxFontFamily: 'Impact', color: '#000000', strokeColor: '#ffffff', strokeWidth: 0 };
}

export function defaultColorStageConfig(): ColorStageConfig {
  return { enabled: false, branch: 'gemini', prompt: '', placement: 'above-inpaint' };
}
