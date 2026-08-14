import { useEffect, useMemo, useState } from 'react';
import { Modal, Button } from '../../ui';
import type { Page } from '../../../types';
import { loadTextEditorDocs, type TextEditorDoc } from '../../../lib/textEditorStore';

interface TextEditorSyncModalProps {
  open: boolean;
  onClose: () => void;
  pages: Page[];
  /** Studio pageId -> that page's already-translated paragraphs, in doc order. Multiple doc pages
   *  assigned to the same Studio page get concatenated. */
  onConfirm: (pageParagraphs: Record<string, string[]>) => void;
}

const SKIP = '__skip__';

/** Very light HTML->paragraph splitting: treats every block boundary (`</p>`, `</div>`, `<br>`,
 *  heading close tags) as a paragraph break, then reads plain text. Formatting (bold/italic) isn't
 *  preserved here — Gemini is separately asked to infer bold/italic/emphasis per bubble from the
 *  art itself (aiPlaceBubbles.ts), same as the fully-automatic Gemini branch does. */
function htmlToParagraphs(html: string): string[] {
  const withBreaks = html
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  const el = document.createElement('div');
  el.innerHTML = withBreaks;
  const text = el.textContent ?? '';
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}

/** Translation's "From Text Editor" branch: pick a Text Editor document, then assign each of the
 *  document's own pages to whichever Studio page it belongs on — one dropdown per doc page, not
 *  per paragraph, since Gemini (aiPlaceBubbles.ts) figures out which bubble each individual
 *  paragraph belongs to from the page art once it has the page-level match and the already-
 *  translated text to place. */
export function TextEditorSyncModal({ open, onClose, pages, onConfirm }: TextEditorSyncModalProps) {
  const [docs, setDocs] = useState<TextEditorDoc[] | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [pageAssignments, setPageAssignments] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!open) return;
    setDocs(null);
    setSelectedDocId(null);
    setPageAssignments({});
    loadTextEditorDocs().then(loaded => {
      const list = loaded ?? [];
      setDocs(list);
      if (list.length > 0) setSelectedDocId(list[0].id);
    });
  }, [open]);

  const selectedDoc = docs?.find(d => d.id === selectedDocId) ?? null;
  const docPageParagraphs = useMemo(
    () => (selectedDoc ? selectedDoc.pages.map(htmlToParagraphs) : []),
    [selectedDoc],
  );

  useEffect(() => { setPageAssignments({}); }, [selectedDocId]);

  const assignedCount = Object.values(pageAssignments).filter(v => v && v !== SKIP).length;

  function handleConfirm() {
    const result: Record<string, string[]> = {};
    docPageParagraphs.forEach((paragraphs, docPageIndex) => {
      const pageId = pageAssignments[docPageIndex];
      if (!pageId || pageId === SKIP || paragraphs.length === 0) return;
      result[pageId] = [...(result[pageId] ?? []), ...paragraphs];
    });
    if (Object.keys(result).length === 0) return;
    onConfirm(result);
  }

  return (
    <Modal open={open} onClose={onClose} title="Sync Text Editor pages" size="lg">
      <div className="flex flex-col gap-4">
        {docs === null ? (
          <p className="text-micro text-ink-faint">Loading documents…</p>
        ) : docs.length === 0 ? (
          <p className="text-micro text-ink-faint">No Text Editor documents yet — open the Text Editor and write/translate one first.</p>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>Document (chapter)</span>
              <select
                value={selectedDocId ?? ''}
                onChange={(e) => setSelectedDocId(e.target.value)}
                className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
              >
                {docs.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </label>

            {docPageParagraphs.length === 0 ? (
              <p className="text-micro text-ink-faint">This document has no pages yet.</p>
            ) : (
              <>
                <p className="text-micro text-ink-faint">{assignedCount} of {docPageParagraphs.length} document pages assigned to a Studio page.</p>
                <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto rounded-control border border-hairline p-2">
                  {docPageParagraphs.map((paragraphs, docPageIndex) => (
                    <div key={docPageIndex} className="flex items-center gap-2 px-1.5 py-1.5 rounded-control hover:bg-ink/5">
                      <div className="flex-1 min-w-0">
                        <div className="text-ui text-ink">Document page {docPageIndex + 1}</div>
                        <div className="text-micro text-ink-faint truncate">
                          {paragraphs.length} line{paragraphs.length === 1 ? '' : 's'} — {paragraphs[0] ?? '(empty)'}
                        </div>
                      </div>
                      <select
                        value={pageAssignments[docPageIndex] ?? SKIP}
                        onChange={(e) => setPageAssignments(prev => ({ ...prev, [docPageIndex]: e.target.value }))}
                        className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1 text-ink text-micro shrink-0 w-44"
                      >
                        <option value={SKIP}>— Skip —</option>
                        {pages.map(p => <option key={p.id} value={p.id}>{p.original.filename || p.id}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex items-center gap-2">
              <Button disabled={assignedCount === 0} onClick={handleConfirm}>Sync {assignedCount} page{assignedCount === 1 ? '' : 's'}</Button>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
