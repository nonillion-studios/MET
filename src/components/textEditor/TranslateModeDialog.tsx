import { useEffect, useState } from 'react';
import { Languages, Sparkles } from 'lucide-react';
import { Modal, Button } from '../ui';
import type { Chapter } from '../../types';

interface TranslateModeDialogProps {
  open: boolean;
  onClose: () => void;
  chapter: Chapter | null;
  /** Null while settings are still loading; empty string once loaded with no key configured. */
  geminiKeyConfigured: boolean | null;
  targetLanguage: string;
  onOpenSettings: () => void;
  onStart: (includedPageIds: string[]) => void;
}

/** Page-selection + start screen for AI Translation mode — lets the user drop pages the AI should
 *  skip (covers, blank pages, already-translated pages) before a run starts. Every page defaults to
 *  included, matching how Select-to-TypeR's "Entire Document" default reads as the common case. */
export function TranslateModeDialog({ open, onClose, chapter, geminiKeyConfigured, targetLanguage, onOpenSettings, onStart }: TranslateModeDialogProps) {
  const [ignored, setIgnored] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setIgnored(new Set());
  }, [open, chapter?.id]);

  if (!open) return null;

  const pages = chapter?.pages ?? [];
  const includedCount = pages.length - ignored.size;

  function toggle(pageId: string) {
    setIgnored(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
      return next;
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI Translation"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onStart(pages.filter(p => !ignored.has(p.id)).map(p => p.id))}
            disabled={!chapter || includedCount === 0 || !geminiKeyConfigured}
          >
            <Sparkles size={13} /> Start Translating ({includedCount})
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {!chapter && (
          <p className="text-sm text-ink-muted">
            This document isn't linked to a chapter yet — open it from a chapter's "Open in Text Editor" button in the Library first.
          </p>
        )}

        {chapter && geminiKeyConfigured === false && (
          <div className="rounded-xl border border-hairline bg-ink/5 p-3 space-y-2">
            <p className="text-xs text-ink-muted">Add a Gemini API key in Settings before starting a translation run.</p>
            <Button size="sm" variant="secondary" onClick={onOpenSettings}>Open Settings</Button>
          </div>
        )}

        {chapter && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                <Languages size={13} /> Target language: <span className="font-medium text-ink">{targetLanguage || 'Not set'}</span>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setIgnored(new Set())} className="text-xs text-accent hover:underline">Select All</button>
                <button type="button" onClick={() => setIgnored(new Set(pages.map(p => p.id)))} className="text-xs text-accent hover:underline">Select None</button>
              </div>
            </div>

            {pages.length === 0 ? (
              <p className="text-sm text-ink-muted">This chapter has no pages yet.</p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-80 overflow-y-auto">
                {pages.map((page, i) => {
                  const image = page.cleaned ?? page.original;
                  const included = !ignored.has(page.id);
                  return (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => toggle(page.id)}
                      className={`relative rounded-lg overflow-hidden border-2 transition-colors ${included ? 'border-accent' : 'border-hairline opacity-40'}`}
                    >
                      <img src={image.dataUrl} alt={`Page ${i + 1}`} className="w-full aspect-[3/4] object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] py-0.5 text-center">{i + 1}</span>
                      <span className={`absolute top-1 right-1 w-4 h-4 rounded-full border flex items-center justify-center ${included ? 'bg-accent border-accent' : 'bg-black/40 border-white/60'}`}>
                        {included && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
