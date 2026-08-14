import { useCallback, useEffect, useRef, useState } from 'react';
import { swal, swalToast } from '../../../lib/swalTheme';
import { inpaintPageWithGemini, AiInpaintError } from '../../../lib/aiInpaint';
import { translatePageBubbles, AiTranslateBubblesError, type TranslatedBubble, type PageContext } from '../../../lib/aiTranslateBubbles';
import { placeTranslatedBubbles, AiPlaceBubblesError } from '../../../lib/aiPlaceBubbles';
import { colorPageWithGemini, AiColorError } from '../../../lib/aiColor';
import { loadAiTranslationSettings } from '../../../lib/aiSettingsStore';
import { loadAutomationRun, saveAutomationRun, clearAutomationRun } from './automationRunStore';
import { createAutomationRunState, type AutomationConfig, type AutomationRunState, type AutomationStageKey, type TranslateStageConfig } from './automationTypes';
import { autoTypesetPage, type DetectBubbleBoundsFn } from './autoTypeset';
import { isLongPage, splitLongPage } from './manhwaSplit';
import { loadImageFromSrc } from '../StudioCanvas';
import type { StudioLayer } from '../studioTypes';
import type { ColorPlacement } from './automationTypes';
import type { Page, ProcessedImage } from '../../../types';

/** Manhwa/webtoon long pages: splits into shorter segments (manhwaSplit.ts) before asking Gemini
 *  to read each one, then remaps every bubble's normalized `seedY` from segment-local (0..1 of the
 *  segment) back to full-page (0..1 of the whole strip) so autoTypeset.ts places it correctly on
 *  the one real page. Segments are translated sequentially, in top-to-bottom reading order, rather
 *  than in parallel — the same "don't hammer the API concurrently, and stay predictable to cancel"
 *  reasoning as the outer per-page loop. */
async function translateLongPageBubbles(source: ProcessedImage, translate: TranslateStageConfig, apiKey: string, pageContext?: PageContext): Promise<TranslatedBubble[]> {
  const img = await loadImageFromSrc(source.dataUrl);
  const segments = splitLongPage(img);
  const all: TranslatedBubble[] = [];
  for (const segment of segments) {
    const bubbles = await translatePageBubbles(segment.dataUrl, translate.prompt, translate.targetLanguage, translate.blackAndWhiteOnly, apiKey, pageContext);
    for (const b of bubbles) {
      all.push({ ...b, seedY: (segment.offsetY + b.seedY * segment.height) / source.height });
    }
  }
  return all;
}

export interface AutomationRunnerDeps {
  chapterId: string;
  pages: Page[];
  showCleaned: boolean;
  /** Inserts the Gemini-returned image as a `placed-image` layer above the background on `pageId`
   *  — see Studio.tsx's `insertAiInpaintLayer`, which mirrors `handlePlaceImageFiles`. */
  insertInpaintLayer: (pageId: string, dataUrl: string) => Promise<void> | void;
  /** Drops autoTypeset.ts's fitted text layers onto `pageId`. */
  insertTextLayers: (pageId: string, layers: StudioLayer[]) => void;
  /** Places the colorized result per the Coloring stage's placement choice. */
  insertColorResult: (pageId: string, dataUrl: string, placement: ColorPlacement) => Promise<void> | void;
  /** StudioCanvas's flood-fill bubble detector — only valid against whichever page is currently
   *  active, which is why the runner switches pages before calling it. */
  detectBubbleBounds: DetectBubbleBoundsFn;
  setActivePageId: (id: string) => void;
}

/** Owns the Automation modal's per-page run: inpaint → translate → typeset → color (whichever
 *  stages are enabled), sequential, with click-to-interrupt/resume and idb-keyval persistence so a
 *  paused run survives a reload. Only each stage's Gemini branch reaches this loop — "already
 *  inpainted"/Custom/"From Text Editor" are handled elsewhere (see their stage panels) with no run
 *  loop of their own. */
export function useAutomationRunner({ chapterId, pages, showCleaned, insertInpaintLayer, insertTextLayers, insertColorResult, detectBubbleBounds, setActivePageId }: AutomationRunnerDeps) {
  const [runState, setRunState] = useState<AutomationRunState | null>(null);
  const runStateRef = useRef<AutomationRunState | null>(null);
  const cancelledRef = useRef(false);
  const confirmOpenRef = useRef(false);
  const depsRef = useRef({ pages, showCleaned, insertInpaintLayer, insertTextLayers, insertColorResult, detectBubbleBounds, setActivePageId });
  depsRef.current = { pages, showCleaned, insertInpaintLayer, insertTextLayers, insertColorResult, detectBubbleBounds, setActivePageId };

  const updateRunState = useCallback((next: AutomationRunState) => {
    runStateRef.current = next;
    setRunState(next);
    void saveAutomationRun(next);
  }, []);

  // Offer to resume a run left paused/mid-flight from a previous session on this chapter.
  useEffect(() => {
    void loadAutomationRun(chapterId).then(saved => {
      if (saved && saved.status !== 'done') {
        const paused = { ...saved, status: 'paused' as const };
        runStateRef.current = paused;
        setRunState(paused);
      }
    });
  }, [chapterId]);

  const setStage = useCallback((stage: AutomationStageKey) => {
    const current = runStateRef.current;
    if (current) updateRunState({ ...current, currentStage: stage });
  }, [updateRunState]);

  const runLoop = useCallback(async (initial: AutomationRunState) => {
    cancelledRef.current = false;
    const settings = await loadAiTranslationSettings();
    const apiKey = settings?.apiKey ?? '';
    const { pageIds } = initial.config.inpaint;
    const { inpaint, translate, typeset, color } = initial.config;

    for (let i = initial.currentPageIndex; i < pageIds.length; i++) {
      if (cancelledRef.current) return;
      const current = runStateRef.current;
      if (!current || current.status !== 'running') return;

      const pageId = pageIds[i];
      depsRef.current.setActivePageId(pageId);
      updateRunState({
        ...current,
        currentPageIndex: i,
        currentStage: 'inpaint',
        perPage: { ...current.perPage, [pageId]: { status: 'processing' } },
      });

      const page = depsRef.current.pages.find(p => p.id === pageId);
      if (!page) {
        const after = runStateRef.current!;
        updateRunState({ ...after, perPage: { ...after.perPage, [pageId]: { status: 'error', error: 'Page no longer exists.' } } });
        continue;
      }

      const source = depsRef.current.showCleaned && page.cleaned ? page.cleaned : page.original;

      try {
        let inpaintedDataUrl: string | null = null;
        if (inpaint.branch === 'gemini') {
          inpaintedDataUrl = await inpaintPageWithGemini(source.dataUrl, inpaint.geminiPrompt, apiKey, inpaint.model);
          await depsRef.current.insertInpaintLayer(pageId, inpaintedDataUrl);
        }

        if (translate.enabled && (translate.branch === 'gemini' || translate.branch === 'text-editor')) {
          setStage('translate');
          let bubbles: TranslatedBubble[];
          if (translate.branch === 'text-editor') {
            // No translation call — the text is already translated (TextEditorSyncModal). Gemini
            // only finds *where* each given paragraph goes; long-page splitting isn't applied here
            // since there's no clean way to know which paragraphs belong in which segment ahead of
            // time, unlike the Gemini branch which discovers everything from the image alone.
            const paragraphs = translate.pageParagraphs?.[pageId] ?? [];
            const placed = paragraphs.length > 0
              ? await placeTranslatedBubbles(source.dataUrl, paragraphs, translate.prompt, apiKey)
              : [];
            bubbles = placed.map(p => ({ ...p, text: paragraphs[p.paragraphIndex] }));
          } else {
            bubbles = isLongPage(source.width, source.height)
              ? await translateLongPageBubbles(source, translate, apiKey)
              : await translatePageBubbles(source.dataUrl, translate.prompt, translate.targetLanguage, translate.blackAndWhiteOnly, apiKey);
          }

          if (typeset.enabled && bubbles.length > 0) {
            setStage('typeset');
            const layers = autoTypesetPage(bubbles, source.width, source.height, depsRef.current.detectBubbleBounds, {
              dialogueFontFamily: typeset.dialogueFontFamily,
              sfxFontFamily: typeset.sfxFontFamily,
              color: typeset.color,
              strokeColor: typeset.strokeColor,
              strokeWidth: typeset.strokeWidth,
            });
            depsRef.current.insertTextLayers(pageId, layers);
          }
        }

        if (color.enabled && color.branch === 'gemini') {
          setStage('color');
          if (!inpaintedDataUrl) {
            // Coloring always runs against a text-removed page — without a fresh inpaint result
            // from *this* run (e.g. the "already inpainted" branch was used instead), there's
            // nothing safe to colorize, so this page is flagged for the user rather than guessed at.
            const after = runStateRef.current!;
            updateRunState({ ...after, perPage: { ...after.perPage, [pageId]: { status: 'needs-review', error: 'No inpainted image from this run to colorize — color it manually.' } } });
            continue;
          }
          const colorUrl = await colorPageWithGemini(inpaintedDataUrl, color.prompt, apiKey);
          await depsRef.current.insertColorResult(pageId, colorUrl, color.placement);
        }

        const after = runStateRef.current!;
        updateRunState({ ...after, perPage: { ...after.perPage, [pageId]: { status: 'done' } } });
      } catch (err) {
        const message = err instanceof AiInpaintError || err instanceof AiTranslateBubblesError || err instanceof AiPlaceBubblesError || err instanceof AiColorError || err instanceof Error
          ? err.message : 'Automation failed on this page.';
        const after = runStateRef.current!;
        updateRunState({ ...after, perPage: { ...after.perPage, [pageId]: { status: 'error', error: message } } });
      }
    }

    const finished = runStateRef.current;
    if (finished && !cancelledRef.current) {
      const elapsedMs = Date.now() - finished.startedAt;
      updateRunState({ ...finished, status: 'done', elapsedMs });
      void clearAutomationRun(chapterId);
      const mins = Math.floor(elapsedMs / 60000);
      const secs = Math.round((elapsedMs % 60000) / 1000);
      swalToast({ icon: 'success', title: `Automation finished — ${pageIds.length} page${pageIds.length === 1 ? '' : 's'} in ${mins}m ${secs}s` });
    }
  }, [chapterId, setStage, updateRunState]);

  const start = useCallback((config: AutomationConfig) => {
    const state = createAutomationRunState(chapterId, config, Date.now());
    updateRunState(state);
    void runLoop(state);
  }, [chapterId, runLoop, updateRunState]);

  const resume = useCallback(() => {
    const state = runStateRef.current;
    if (!state) return;
    const resumed: AutomationRunState = { ...state, status: 'running' };
    updateRunState(resumed);
    void runLoop(resumed);
  }, [runLoop, updateRunState]);

  const requestStop = useCallback(async () => {
    if (confirmOpenRef.current) return;
    confirmOpenRef.current = true;
    const { isConfirmed } = await swal({
      title: 'Stop AI automation?',
      text: 'You can resume this run later from the Automation button.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Stop',
      cancelButtonText: 'Keep going',
    });
    confirmOpenRef.current = false;
    if (isConfirmed) {
      cancelledRef.current = true;
      const state = runStateRef.current;
      if (state) updateRunState({ ...state, status: 'paused' });
    }
  }, [updateRunState]);

  // Click-to-interrupt: any click anywhere in the app while a run is live pauses it (after
  // confirming) instead of acting on whatever was clicked. Guarded off while the confirm dialog
  // itself is open so its own Stop/Keep going buttons still work.
  useEffect(() => {
    if (runState?.status !== 'running') return;
    const handler = (e: MouseEvent) => {
      if (confirmOpenRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      void requestStop();
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [runState?.status, requestStop]);

  const dismiss = useCallback(() => {
    void clearAutomationRun(chapterId);
    runStateRef.current = null;
    setRunState(null);
  }, [chapterId]);

  return { runState, start, resume, requestStop, dismiss };
}
