import { useMemo, useRef, useState } from 'react';
import { Reorder, useDragControls } from 'motion/react';
import {
  Upload, FileImage, GripVertical, Trash2, CheckCircle2, Circle,
  Sparkles, Link2Off, ImageOff, Wand2,
} from 'lucide-react';
import { Button, IconButton, Modal } from '../ui';
import { extractImagesFromZip } from '../../lib/zip';
import { extractImagesFromFiles, createPagesFromOriginals, suggestPairing, type ImageExtractionResult } from '../../lib/pages';
import { swal, swalToast } from '../../lib/swalTheme';
import type { Page, ProcessedImage } from '../../types';

interface PagesManagePanelProps {
  open: boolean;
  onClose: () => void;
  chapterName: string;
  pages: Page[];
  onChange: (pages: Page[]) => void;
  /** Diffs `whited` against `page.original` and seeds a masked clean-patch layer from the result. */
  onCreateWhitedPatchLayer: (page: Page, whited: ProcessedImage) => void;
}

type DragPayload = { source: 'pool'; kind: 'cleaned' | 'whited' } | { source: 'page'; kind: 'cleaned' | 'whited'; pageId: string };

export function PagesManagePanel({ open, onClose, chapterName, pages, onChange, onCreateWhitedPatchLayer }: PagesManagePanelProps) {
  const [unmatchedCleaned, setUnmatchedCleaned] = useState<ProcessedImage[]>([]);
  const [unmatchedWhited, setUnmatchedWhited] = useState<ProcessedImage[]>([]);
  // Whited-reference images are a transient diff input, never persisted on Page/types.ts —
  // held locally here, keyed by page id, and dropped once the panel unmounts.
  const [whitedByPage, setWhitedByPage] = useState<Record<string, ProcessedImage>>({});
  const [busy, setBusy] = useState(false);
  const originalZipRef = useRef<HTMLInputElement>(null);
  const originalFilesRef = useRef<HTMLInputElement>(null);
  const cleanedZipRef = useRef<HTMLInputElement>(null);
  const cleanedFilesRef = useRef<HTMLInputElement>(null);
  const whitedZipRef = useRef<HTMLInputElement>(null);
  const whitedFilesRef = useRef<HTMLInputElement>(null);

  const pairedCount = useMemo(() => pages.filter(p => p.cleaned).length, [pages]);

  const addOriginals = (images: ProcessedImage[]) => {
    const newPages = createPagesFromOriginals(images);
    const merged = [...pages, ...newPages].map((p, i) => ({ ...p, order: i }));
    onChange(merged);
    swalToast({ icon: 'success', title: `Added ${images.length} page(s)` });
  };

  const addCleaned = (images: ProcessedImage[]) => {
    const { pages: matched, unmatched } = suggestPairing(pages, images);
    onChange(matched);
    setUnmatchedCleaned(prev => [...prev, ...unmatched]);
    if (unmatched.length > 0) {
      swalToast({ icon: 'info', title: `${images.length - unmatched.length} paired automatically`, text: `${unmatched.length} need manual placement` });
    } else {
      swalToast({ icon: 'success', title: `Paired ${images.length} cleaned page(s)` });
    }
  };

  const addWhited = (images: ProcessedImage[]) => {
    // Reuse the same original/cleaned pairing heuristic (filename, then page number, then
    // position) against a scratch "cleaned" slot per page so suggestPairing's matching logic
    // works unmodified for this third, non-persisted image set.
    const scratchPages = pages.map(p => ({ ...p, cleaned: whitedByPage[p.id] ?? null }));
    const { pages: matched, unmatched } = suggestPairing(scratchPages, images);
    const nextByPage: Record<string, ProcessedImage> = { ...whitedByPage };
    for (const p of matched) {
      if (p.cleaned) nextByPage[p.id] = p.cleaned;
    }
    setWhitedByPage(nextByPage);
    setUnmatchedWhited(prev => [...prev, ...unmatched]);
    if (unmatched.length > 0) {
      swalToast({ icon: 'info', title: `${images.length - unmatched.length} whited page(s) paired`, text: `${unmatched.length} need manual placement` });
    } else {
      swalToast({ icon: 'success', title: `Paired ${images.length} whited reference page(s)` });
    }
  };

  const runImport = async (kind: 'original' | 'cleaned' | 'whited', run: () => Promise<ImageExtractionResult>) => {
    setBusy(true);
    try {
      const { images, skipped } = await run();
      if (images.length === 0) {
        const detail = skipped.length > 0
          ? `Every file was skipped: ${skipped.map(s => `${s.filename} (${s.reason})`).join(', ')}`
          : 'That upload did not contain any supported images.';
        swal({ icon: 'warning', title: 'No images found', text: detail });
        return;
      }
      if (kind === 'original') addOriginals(images);
      else if (kind === 'cleaned') addCleaned(images);
      else addWhited(images);
      if (skipped.length > 0) {
        swalToast({
          icon: 'warning',
          title: `${skipped.length} file(s) skipped`,
          text: skipped.slice(0, 3).map(s => `${s.filename}: ${s.reason}`).join('; ') + (skipped.length > 3 ? '…' : ''),
        });
      }
    } catch (err) {
      console.error(err);
      const detail = err instanceof Error && err.message ? err.message : 'The file might be corrupted or in an unsupported format.';
      swal({ icon: 'error', title: 'Import Failed', text: detail });
    } finally {
      setBusy(false);
    }
  };

  const handleOriginalZip = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) runImport('original', () => extractImagesFromZip(file));
    e.target.value = '';
  };
  const handleOriginalFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) runImport('original', () => extractImagesFromFiles(files));
    e.target.value = '';
  };
  const handleCleanedZip = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) runImport('cleaned', () => extractImagesFromZip(file));
    e.target.value = '';
  };
  const handleCleanedFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) runImport('cleaned', () => extractImagesFromFiles(files));
    e.target.value = '';
  };
  const handleWhitedZip = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) runImport('whited', () => extractImagesFromZip(file));
    e.target.value = '';
  };
  const handleWhitedFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) runImport('whited', () => extractImagesFromFiles(files));
    e.target.value = '';
  };

  const removePage = (pageId: string) => {
    const page = pages.find(p => p.id === pageId);
    if (page?.cleaned) setUnmatchedCleaned(prev => [...prev, page.cleaned as ProcessedImage]);
    if (whitedByPage[pageId]) {
      setUnmatchedWhited(prev => [...prev, whitedByPage[pageId]]);
      setWhitedByPage(prev => { const next = { ...prev }; delete next[pageId]; return next; });
    }
    onChange(pages.filter(p => p.id !== pageId).map((p, i) => ({ ...p, order: i })));
  };

  const handleReorder = (newOrder: Page[]) => {
    onChange(newOrder.map((p, i) => ({ ...p, order: i })));
  };

  // Native drag-and-drop pairing: drag a cleaned/whited thumbnail (from the pool or another
  // page's slot) onto a page's slot to assign/swap it.
  const startDrag = (e: React.DragEvent, payload: DragPayload) => {
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };

  const dropOnPage = (e: React.DragEvent, targetPageId: string) => {
    e.preventDefault();
    let payload: DragPayload;
    try {
      payload = JSON.parse(e.dataTransfer.getData('application/json'));
    } catch {
      return;
    }

    const targetPage = pages.find(p => p.id === targetPageId);
    if (!targetPage) return;
    if (payload.source === 'page' && payload.pageId === targetPageId) return;

    if (payload.kind === 'whited') {
      const imageId = e.dataTransfer.getData('text/plain');
      if (payload.source === 'pool') {
        const poolIndex = unmatchedWhited.findIndex(img => img.id === imageId);
        if (poolIndex === -1) return;
        const draggedImage = unmatchedWhited[poolIndex];
        const displaced = whitedByPage[targetPageId];
        setWhitedByPage(prev => ({ ...prev, [targetPageId]: draggedImage }));
        setUnmatchedWhited(prev => {
          const next = prev.filter((_, i) => i !== poolIndex);
          return displaced ? [...next, displaced] : next;
        });
      } else {
        const sourcePageId = payload.pageId;
        const sourceWhited = whitedByPage[sourcePageId];
        const targetWhited = whitedByPage[targetPageId];
        setWhitedByPage(prev => ({ ...prev, [sourcePageId]: targetWhited, [targetPageId]: sourceWhited }));
      }
      return;
    }

    if (payload.source === 'pool') {
      const imageId = e.dataTransfer.getData('text/plain');
      const poolIndex = unmatchedCleaned.findIndex(img => img.id === imageId);
      if (poolIndex === -1) return;
      const draggedImage = unmatchedCleaned[poolIndex];
      const displaced = targetPage.cleaned;
      onChange(pages.map(p => p.id === targetPageId ? { ...p, cleaned: draggedImage } : p));
      setUnmatchedCleaned(prev => {
        const next = prev.filter((_, i) => i !== poolIndex);
        return displaced ? [...next, displaced] : next;
      });
    } else {
      const sourcePage = pages.find(p => p.id === payload.pageId);
      if (!sourcePage) return;
      const sourceCleaned = sourcePage.cleaned;
      const targetCleaned = targetPage.cleaned;
      onChange(pages.map(p => {
        if (p.id === sourcePage.id) return { ...p, cleaned: targetCleaned };
        if (p.id === targetPageId) return { ...p, cleaned: sourceCleaned };
        return p;
      }));
    }
  };

  const unassignCleaned = (pageId: string) => {
    const page = pages.find(p => p.id === pageId);
    if (!page?.cleaned) return;
    setUnmatchedCleaned(prev => [...prev, page.cleaned as ProcessedImage]);
    onChange(pages.map(p => p.id === pageId ? { ...p, cleaned: null } : p));
  };

  const unassignWhited = (pageId: string) => {
    const whited = whitedByPage[pageId];
    if (!whited) return;
    setUnmatchedWhited(prev => [...prev, whited]);
    setWhitedByPage(prev => { const next = { ...prev }; delete next[pageId]; return next; });
  };

  return (
    <Modal open={open} onClose={onClose} title={`Manage Pages — ${chapterName}`} size="lg" className="studio-shell">
      <div className="space-y-5">
        <div>
          <p className="text-sm text-ink-muted max-w-lg">
            Upload pages, reorder them, and sync cleaned or whited-reference versions.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <div className="rounded-panel border border-hairline p-4 space-y-2.5">
            <p className="text-ui font-semibold text-ink uppercase tracking-wide flex items-center gap-1.5">
              <FileImage size={13} className="text-accent" /> Original Pages
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => originalZipRef.current?.click()}>
                <Upload size={13} /> ZIP
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => originalFilesRef.current?.click()}>
                <Upload size={13} /> Images
              </Button>
            </div>
            <input ref={originalZipRef} type="file" accept=".zip" className="hidden" onChange={handleOriginalZip} />
            <input ref={originalFilesRef} type="file" accept="image/*" multiple className="hidden" onChange={handleOriginalFiles} />
          </div>

          <div className="rounded-panel border border-hairline p-4 space-y-2.5">
            <p className="text-ui font-semibold text-ink uppercase tracking-wide flex items-center gap-1.5">
              <Sparkles size={13} className="text-accent" /> Cleaned / Bleached
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => cleanedZipRef.current?.click()}>
                <Upload size={13} /> ZIP
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => cleanedFilesRef.current?.click()}>
                <Upload size={13} /> Images
              </Button>
            </div>
            <input ref={cleanedZipRef} type="file" accept=".zip" className="hidden" onChange={handleCleanedZip} />
            <input ref={cleanedFilesRef} type="file" accept="image/*" multiple className="hidden" onChange={handleCleanedFiles} />
          </div>

          <div className="rounded-panel border border-hairline p-4 space-y-2.5">
            <p className="text-ui font-semibold text-ink uppercase tracking-wide flex items-center gap-1.5">
              <Wand2 size={13} className="text-accent" /> Whited Reference
            </p>
            <p className="text-micro text-ink-faint">A manually text-erased version — differences from the original become an editable masked layer.</p>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => whitedZipRef.current?.click()}>
                <Upload size={13} /> ZIP
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => whitedFilesRef.current?.click()}>
                <Upload size={13} /> Images
              </Button>
            </div>
            <input ref={whitedZipRef} type="file" accept=".zip" className="hidden" onChange={handleWhitedZip} />
            <input ref={whitedFilesRef} type="file" accept="image/*" multiple className="hidden" onChange={handleWhitedFiles} />
          </div>
        </div>

        {pages.length > 0 && (
          <div className="flex items-center gap-2 text-ui text-ink-muted">
            <CheckCircle2 size={13} className="text-success" />
            {pairedCount} of {pages.length} page(s) have a synced cleaned version
          </div>
        )}

        {unmatchedCleaned.length > 0 && (
          <div className="rounded-panel border border-warning/30 p-4">
            <p className="text-ui font-semibold text-ink uppercase tracking-wide flex items-center gap-1.5 mb-3">
              <Link2Off size={13} className="text-warning" /> Unmatched Cleaned Pages — drag onto a page below to pair
            </p>
            <div className="flex gap-2.5 flex-wrap">
              {unmatchedCleaned.map(img => (
                <div
                  key={img.id}
                  draggable
                  onDragStart={(e) => {
                    startDrag(e, { source: 'pool', kind: 'cleaned' });
                    e.dataTransfer.setData('text/plain', img.id);
                  }}
                  className="w-16 h-22 aspect-[2/3] rounded-control overflow-hidden border-2 border-dashed border-warning/50 cursor-grab active:cursor-grabbing shrink-0 bg-ink/5"
                  title={img.filename}
                >
                  <img src={img.dataUrl} alt={img.filename} className="w-full h-full object-cover pointer-events-none" draggable={false} />
                </div>
              ))}
            </div>
          </div>
        )}

        {unmatchedWhited.length > 0 && (
          <div className="rounded-panel border border-warning/30 p-4">
            <p className="text-ui font-semibold text-ink uppercase tracking-wide flex items-center gap-1.5 mb-3">
              <Link2Off size={13} className="text-warning" /> Unmatched Whited Pages — drag onto a page below to pair
            </p>
            <div className="flex gap-2.5 flex-wrap">
              {unmatchedWhited.map(img => (
                <div
                  key={img.id}
                  draggable
                  onDragStart={(e) => {
                    startDrag(e, { source: 'pool', kind: 'whited' });
                    e.dataTransfer.setData('text/plain', img.id);
                  }}
                  className="w-16 h-22 aspect-[2/3] rounded-control overflow-hidden border-2 border-dashed border-warning/50 cursor-grab active:cursor-grabbing shrink-0 bg-ink/5"
                  title={img.filename}
                >
                  <img src={img.dataUrl} alt={img.filename} className="w-full h-full object-cover pointer-events-none" draggable={false} />
                </div>
              ))}
            </div>
          </div>
        )}

        {pages.length === 0 ? (
          <div className="rounded-panel border border-hairline p-10 flex flex-col items-center text-center gap-3">
            <ImageOff className="text-ink-faint" size={28} />
            <p className="text-sm text-ink-muted max-w-sm">No pages yet. Upload a ZIP or individual images to get started.</p>
          </div>
        ) : (
          <div className="rounded-panel border border-hairline p-4">
            <p className="text-ui font-semibold text-ink uppercase tracking-wide mb-3">
              {pages.length} Page{pages.length !== 1 ? 's' : ''} — drag the grip to reorder, drag thumbnails to pair
            </p>
            <Reorder.Group
              as="div"
              axis="y"
              values={pages}
              onReorder={handleReorder}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              {pages.map((page, index) => (
                <PageCard
                  key={page.id}
                  page={page}
                  index={index}
                  whited={whitedByPage[page.id] ?? null}
                  onRemove={() => removePage(page.id)}
                  onUnassignCleaned={() => unassignCleaned(page.id)}
                  onUnassignWhited={() => unassignWhited(page.id)}
                  onDropCleaned={(e) => dropOnPage(e, page.id)}
                  onDropWhited={(e) => dropOnPage(e, page.id)}
                  onDragStartCleaned={(e) => startDrag(e, { source: 'page', kind: 'cleaned', pageId: page.id })}
                  onDragStartWhited={(e) => startDrag(e, { source: 'page', kind: 'whited', pageId: page.id })}
                  onCreatePatchLayer={() => {
                    const whited = whitedByPage[page.id];
                    if (whited) onCreateWhitedPatchLayer(page, whited);
                  }}
                />
              ))}
            </Reorder.Group>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PageCard({
  page, index, whited, onRemove, onUnassignCleaned, onUnassignWhited,
  onDropCleaned, onDropWhited, onDragStartCleaned, onDragStartWhited, onCreatePatchLayer,
}: {
  page: Page;
  index: number;
  whited: ProcessedImage | null;
  onRemove: () => void;
  onUnassignCleaned: () => void;
  onUnassignWhited: () => void;
  onDropCleaned: (e: React.DragEvent) => void;
  onDropWhited: (e: React.DragEvent) => void;
  onDragStartCleaned: (e: React.DragEvent) => void;
  onDragStartWhited: (e: React.DragEvent) => void;
  onCreatePatchLayer: () => void;
}) {
  const dragControls = useDragControls();
  const [dragOverCleaned, setDragOverCleaned] = useState(false);
  const [dragOverWhited, setDragOverWhited] = useState(false);

  return (
    <Reorder.Item
      value={page}
      dragListener={false}
      dragControls={dragControls}
      className="rounded-panel border border-hairline bg-ink/[0.02] overflow-hidden"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-hairline bg-ink/5">
        <button
          onPointerDown={(e) => dragControls.start(e)}
          className="cursor-grab active:cursor-grabbing text-ink-faint hover:text-accent touch-none p-0.5"
          aria-label="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>
        <span className="text-ui font-mono text-ink-muted">#{index + 1}</span>
        <span className="text-ui text-ink-faint truncate flex-1">{page.original.filename}</span>
        <IconButton size="sm" aria-label="Remove page" onClick={onRemove} className="!w-7 !h-7 !bg-transparent !border-0 hover:!text-danger">
          <Trash2 size={13} />
        </IconButton>
      </div>
      <div className="grid grid-cols-3 gap-2 p-2.5">
        <div className="space-y-1">
          <p className="text-micro text-ink-faint uppercase tracking-wide text-center">Original</p>
          <div className="aspect-[2/3] rounded-control overflow-hidden border border-hairline bg-ink/5">
            <img src={page.original.dataUrl} alt={page.original.filename} className="w-full h-full object-cover" draggable={false} />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-micro text-ink-faint uppercase tracking-wide text-center">Cleaned</p>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOverCleaned(true); }}
            onDragLeave={() => setDragOverCleaned(false)}
            onDrop={(e) => { setDragOverCleaned(false); onDropCleaned(e); }}
            className={`aspect-[2/3] rounded-control overflow-hidden border-2 flex items-center justify-center relative group transition-colors ${
              dragOverCleaned ? 'border-accent bg-accent-soft' : 'border-dashed border-hairline bg-ink/5'
            }`}
          >
            {page.cleaned ? (
              <>
                <img
                  src={page.cleaned.dataUrl}
                  alt={page.cleaned.filename}
                  draggable
                  onDragStart={(e) => { onDragStartCleaned(e); e.dataTransfer.setData('text/plain', page.cleaned!.id); }}
                  className="w-full h-full object-cover cursor-grab active:cursor-grabbing"
                />
                <button
                  onClick={onUnassignCleaned}
                  className="absolute top-1 right-1 p-1 rounded-control bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Unpair cleaned page"
                >
                  <Link2Off size={11} />
                </button>
              </>
            ) : (
              <Circle size={16} className="text-ink-faint" />
            )}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-micro text-ink-faint uppercase tracking-wide text-center">Whited</p>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOverWhited(true); }}
            onDragLeave={() => setDragOverWhited(false)}
            onDrop={(e) => { setDragOverWhited(false); onDropWhited(e); }}
            className={`aspect-[2/3] rounded-control overflow-hidden border-2 flex items-center justify-center relative group transition-colors ${
              dragOverWhited ? 'border-accent bg-accent-soft' : 'border-dashed border-hairline bg-ink/5'
            }`}
          >
            {whited ? (
              <>
                <img
                  src={whited.dataUrl}
                  alt={whited.filename}
                  draggable
                  onDragStart={(e) => { onDragStartWhited(e); e.dataTransfer.setData('text/plain', whited.id); }}
                  className="w-full h-full object-cover cursor-grab active:cursor-grabbing"
                />
                <button
                  onClick={onUnassignWhited}
                  className="absolute top-1 right-1 p-1 rounded-control bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Unpair whited reference"
                >
                  <Link2Off size={11} />
                </button>
              </>
            ) : (
              <Circle size={16} className="text-ink-faint" />
            )}
          </div>
        </div>
      </div>
      {whited && (
        <div className="px-2.5 pb-2.5">
          <Button size="sm" variant="secondary" className="w-full" onClick={onCreatePatchLayer}>
            <Wand2 size={13} /> Create Patch Layer from Diff
          </Button>
        </div>
      )}
    </Reorder.Item>
  );
}
