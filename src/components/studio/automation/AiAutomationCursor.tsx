import { motion, AnimatePresence } from 'motion/react';
import { MousePointer2, Loader2, X } from 'lucide-react';
import type { AutomationRunState, AutomationStageKey } from './automationTypes';

interface AiAutomationCursorProps {
  runState: AutomationRunState | null;
  onStop: () => void;
}

/** The "AI is working" HUD — a small animated mac-style cursor pill pinned to the corner while a
 *  run is live, showing which page it's on. Purely cosmetic/status signaling inside this web app's
 *  own DOM (see automationTypes.ts's doc comment); it never synthesizes real input events. */
export function AiAutomationCursor({ runState, onStop }: AiAutomationCursorProps) {
  const visible = runState?.status === 'running';
  if (!visible || !runState) return null;

  const pageIds = runState.config.inpaint.pageIds;
  const total = pageIds.length;
  const index = Math.min(runState.currentPageIndex, Math.max(total - 1, 0));
  const currentPageId = pageIds[index];
  const pageState = currentPageId ? runState.perPage[currentPageId] : undefined;
  const stageLabel: Record<AutomationStageKey, string> = {
    inpaint: 'Inpainting', translate: 'Translating', typeset: 'Typesetting', color: 'Coloring',
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.95 }}
        className="fixed bottom-5 right-5 z-[90] flex items-center gap-3 rounded-full border border-hairline bg-surface/95 backdrop-blur-md shadow-lg px-4 py-2.5"
      >
        <motion.div
          animate={{ x: [0, 4, 0, -3, 0], y: [0, -2, 2, 0, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="relative shrink-0 text-accent"
        >
          <MousePointer2 size={18} className="fill-accent/20" />
        </motion.div>

        <div className="flex flex-col leading-tight">
          <span className="text-ui font-medium text-ink">Gemini is automating this chapter</span>
          <span className="text-micro text-ink-faint">
            {pageState?.status === 'error' ? 'Page failed — continuing…' : stageLabel[runState.currentStage]} page {index + 1} of {total}
          </span>
        </div>

        <Loader2 size={14} className="animate-spin text-ink-faint shrink-0" />

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStop(); }}
          aria-label="Stop AI automation"
          title="Stop"
          className="shrink-0 flex items-center justify-center w-6 h-6 rounded-full text-ink-faint hover:text-danger hover:bg-danger/10 transition-colors"
        >
          <X size={14} />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
