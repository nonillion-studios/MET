import { useMemo, useState } from 'react';
import { ClipboardCopy, Wand2 } from 'lucide-react';
import { Button } from '../../ui';
import type { Page } from '../../../types';
import type { StudioLayer } from '../studioTypes';
import { checkPageRegistered } from './InpaintStagePanel';
import { buildHandoffPrompt, parseBubblesFromJsonText } from '../../../lib/aiTranslateBubbles';
import { autoTypesetPage, type AutoTypesetStyle, type DetectBubbleBoundsFn } from './autoTypeset';
import { swalToast } from '../../../lib/swalTheme';

interface JsonHandoffPanelProps {
  pages: Page[];
  layersByPage: Record<string, StudioLayer[]>;
  activePageId: string | null;
  onJumpToPage: (pageId: string) => void;
  onInsertTextLayers: (pageId: string, layers: StudioLayer[]) => void;
  detectBubbleBounds: DetectBubbleBoundsFn;
  typesetStyle: AutoTypesetStyle;
}

/** One-page-at-a-time hand-off to any external AI tool: copy a self-contained prompt (same JSON
 *  schema the Gemini Translation branch uses — see aiTranslateBubbles.ts), paste it plus this
 *  page's image into any chat, then paste the reply back here to typeset it with the same
 *  flood-fill-correct-and-autofit algorithm the automated pipeline uses. Deliberately one page per
 *  request, matching the request that multi-page prompts risk confusing the external AI. */
export function JsonHandoffPanel({ pages, layersByPage, activePageId, onJumpToPage, onInsertTextLayers, detectBubbleBounds, typesetStyle }: JsonHandoffPanelProps) {
  const inpaintedPages = useMemo(() => pages.filter(p => checkPageRegistered(layersByPage[p.id] ?? [], p)), [pages, layersByPage]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(inpaintedPages[0]?.id ?? null);
  const [pasted, setPasted] = useState('');

  const selectedPage = pages.find(p => p.id === selectedPageId) ?? null;
  const isActivePage = selectedPageId != null && selectedPageId === activePageId;

  async function copyPrompt() {
    if (!selectedPage) return;
    try {
      await navigator.clipboard.writeText(buildHandoffPrompt('English'));
      swalToast({ icon: 'success', title: 'Prompt copied — paste it with this page\'s image into any AI tool' });
    } catch {
      swalToast({ icon: 'error', title: 'Could not access the clipboard' });
    }
  }

  function typesetPastedJson() {
    if (!selectedPage) return;
    let bubbles;
    try {
      bubbles = parseBubblesFromJsonText(pasted);
    } catch (err) {
      swalToast({ icon: 'error', title: 'Could not parse that JSON', text: err instanceof Error ? err.message : undefined });
      return;
    }
    if (bubbles.length === 0) {
      swalToast({ icon: 'info', title: 'No bubbles found in that JSON' });
      return;
    }
    const layers = autoTypesetPage(bubbles, selectedPage.original.width, selectedPage.original.height, detectBubbleBounds, typesetStyle);
    onInsertTextLayers(selectedPage.id, layers);
    swalToast({ icon: 'success', title: `Typeset ${layers.length} bubble${layers.length === 1 ? '' : 's'}` });
    setPasted('');
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-display text-ui font-semibold text-ink mb-1">JSON Hand-off</h3>
        <p className="text-micro text-ink-faint">Use any AI tool (even one without an API key) to translate one page at a time, then typeset its reply here.</p>
      </div>

      {inpaintedPages.length === 0 ? (
        <p className="text-micro text-ink-faint">No inpainted pages yet — run the Inpainting stage first.</p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-micro text-ink-faint">
            <span>Page</span>
            <select
              value={selectedPageId ?? ''}
              onChange={(e) => setSelectedPageId(e.target.value)}
              className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
            >
              {inpaintedPages.map(p => <option key={p.id} value={p.id}>{p.original.filename || p.id}</option>)}
            </select>
          </label>

          <Button variant="secondary" size="sm" onClick={copyPrompt} className="self-start">
            <ClipboardCopy size={13} /> Copy prompt for this page
          </Button>

          <label className="flex flex-col gap-1 text-micro text-ink-faint">
            <span>Paste the AI's JSON reply</span>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={6}
              placeholder='[{ "text": "...", "isSfx": false, "seedX": 0.5, "seedY": 0.3, "rotation": 0 }]'
              className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2.5 py-2 text-ink text-ui font-mono text-micro resize-none"
            />
          </label>

          {isActivePage ? (
            <Button size="sm" disabled={!pasted.trim()} onClick={typesetPastedJson} className="self-start">
              <Wand2 size={13} /> Typeset this page
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => selectedPageId && onJumpToPage(selectedPageId)} className="self-start">
              Open this page first
            </Button>
          )}
        </>
      )}
    </div>
  );
}
