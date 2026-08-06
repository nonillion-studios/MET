import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Upload, X } from 'lucide-react';
import { IconButton } from '../ui';
import type { Chapter, Workspace } from '../../types';

const STORAGE_KEY = 'text_editor_split_preview';
const STORAGE_SCHEMA_VERSION = 1;
const STORAGE_DEBOUNCE_MS = 400;

interface StoredSelection {
  v: number;
  chapterId: string | null;
  pageIndex: number;
}

interface FlatChapter {
  id: string;
  label: string;
  chapter: Chapter;
}

function loadStoredSelection(): { chapterId: string | null; pageIndex: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { chapterId: null, pageIndex: 0 };
    const parsed = JSON.parse(raw) as StoredSelection;
    if (parsed.v !== STORAGE_SCHEMA_VERSION) return { chapterId: null, pageIndex: 0 };
    return { chapterId: parsed.chapterId, pageIndex: parsed.pageIndex };
  } catch {
    return { chapterId: null, pageIndex: 0 };
  }
}

function flattenChapters(workspaces: Workspace[]): FlatChapter[] {
  const flat: FlatChapter[] = [];
  for (const workspace of workspaces) {
    for (const manga of workspace.mangas) {
      for (const volume of manga.volumes) {
        for (const chapter of volume.chapters) {
          flat.push({ id: chapter.id, label: `${manga.title} / ${volume.name} / ${chapter.name}`, chapter });
        }
      }
    }
  }
  return flat;
}

interface SplitScreenPreviewProps {
  workspaces: Workspace[];
  /** Whichever chapter is currently linked to this doc/open in Studio, used only to pick a
   *  sensible *default* selection — the dropdown stays fully changeable/browsable afterward, and
   *  this never overrides an already-stored user selection. */
  activeChapterId?: string | null;
  /** Follows Studio's live active page — but only the moment it *changes*, so browsing the preview
   *  independently afterward (via its own prev/next controls) doesn't keep getting yanked back.
   *  Mirrors the same snap-once convention this component's own stored-selection restore uses. */
  studioActivePageId?: string | null;
  /** AI Translation mode's chapter — forces the preview onto this chapter the moment it *changes*
   *  (unlike `activeChapterId`, which only ever picks a *default* when nothing is stored yet). Set
   *  by TextEditorPage.tsx when a translation run starts, so the preview follows along even if the
   *  user had a different chapter selected here. */
  forceChapterId?: string | null;
  /** AI Translation mode's current page — snaps the preview to it the moment it *changes*, the same
   *  "changes the photo to the next page" behavior TypeR's own page auto-advance already relies on
   *  in Studio (see StudioCanvas's Page-N-hint effect). */
  forcePageId?: string | null;
  onClose: () => void;
}

export function SplitScreenPreview({ workspaces, activeChapterId, studioActivePageId, forceChapterId, forcePageId, onClose }: SplitScreenPreviewProps) {
  const flatChapters = useMemo(() => flattenChapters(workspaces), [workspaces]);

  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(() => loadStoredSelection().chapterId);
  const [selectedPageIndex, setSelectedPageIndex] = useState(() => loadStoredSelection().pageIndex);
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);
  const [uploadedIsPdf, setUploadedIsPdf] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadedUrlRef = useRef<string | null>(null);

  // Default to a chapter if none stored yet and one becomes available — prefer whichever chapter
  // is actively linked/open elsewhere, falling back to the first one that exists at all.
  useEffect(() => {
    if (selectedChapterId !== null || flatChapters.length === 0) return;
    const preferred = activeChapterId && flatChapters.some(f => f.id === activeChapterId) ? activeChapterId : flatChapters[0].id;
    setSelectedChapterId(preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatChapters.length]);

  // Follows Studio's live active page once, the moment it changes — the preview's own prev/next
  // controls can still browse away from it independently afterward.
  useEffect(() => {
    if (!studioActivePageId || !selectedChapter) return;
    const idx = selectedChapter.pages.findIndex(p => p.id === studioActivePageId);
    if (idx >= 0) setSelectedPageIndex(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioActivePageId]);

  // AI Translation mode forcing the preview onto the chapter it's translating, the moment that
  // changes (a real switch, unlike activeChapterId's "only when nothing is stored yet" default).
  useEffect(() => {
    if (!forceChapterId || !flatChapters.some(f => f.id === forceChapterId)) return;
    setSelectedChapterId(forceChapterId);
    clearUpload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceChapterId]);

  // AI Translation mode advancing "the photo" to whichever page it's currently translating.
  useEffect(() => {
    if (!forcePageId || !selectedChapter) return;
    const idx = selectedChapter.pages.findIndex(p => p.id === forcePageId);
    if (idx >= 0) { setSelectedPageIndex(idx); clearUpload(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcePageId]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const stored: StoredSelection = { v: STORAGE_SCHEMA_VERSION, chapterId: selectedChapterId, pageIndex: selectedPageIndex };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      } catch {
        // Storage full/unavailable — selection just won't persist this time, not fatal.
      }
    }, STORAGE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [selectedChapterId, selectedPageIndex]);

  useEffect(() => () => {
    if (uploadedUrlRef.current) URL.revokeObjectURL(uploadedUrlRef.current);
  }, []);

  const selectedChapter = flatChapters.find(f => f.id === selectedChapterId)?.chapter ?? null;
  const pageCount = selectedChapter?.pages.length ?? 0;
  const clampedIndex = pageCount > 0 ? Math.min(selectedPageIndex, pageCount - 1) : 0;
  const currentPage = selectedChapter?.pages[clampedIndex] ?? null;
  const currentImage = currentPage ? (currentPage.cleaned ?? currentPage.original) : null;

  function handleChapterChange(id: string) {
    setSelectedChapterId(id);
    setSelectedPageIndex(0);
    clearUpload();
  }

  function goPrev() {
    setSelectedPageIndex(i => Math.max(0, i - 1));
    clearUpload();
  }

  function goNext() {
    setSelectedPageIndex(i => Math.min(pageCount - 1, i + 1));
    clearUpload();
  }

  function clearUpload() {
    if (uploadedUrlRef.current) {
      URL.revokeObjectURL(uploadedUrlRef.current);
      uploadedUrlRef.current = null;
    }
    setUploadedPreviewUrl(null);
    setUploadedIsPdf(false);
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const file = files[0];
    if (!file) return;
    if (uploadedUrlRef.current) URL.revokeObjectURL(uploadedUrlRef.current);
    const url = URL.createObjectURL(file);
    uploadedUrlRef.current = url;
    setUploadedPreviewUrl(url);
    setUploadedIsPdf(file.type === 'application/pdf');
  }

  const hasSelection = selectedChapterId !== null && flatChapters.length > 0;

  return (
    // flex-1 (not a fixed width) so it fills whatever the divider's ratio gives it; min-w-[300px]
    // is the spec's own floor. Always-dark chrome regardless of the app's light/dark theme toggle —
    // the same "chrome stays dark on purpose" convention Studio's own shell already uses — so it
    // reads clearly against the white text pages on the left at any theme setting.
    <div className="flex-1 min-w-[300px] flex flex-col h-full min-h-0 bg-[#1a1a1a]">
      <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-white/10">
        <span className="text-xs font-semibold text-white/90">Manga Preview</span>
        <IconButton size="sm" aria-label="Close split screen" onClick={onClose} className="!bg-transparent !text-white/70 hover:!text-white">
          <X size={14} />
        </IconButton>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2 border-b border-white/10">
        <label className="text-[11px] text-white/50 font-medium">Chapter</label>
        <select
          value={selectedChapterId ?? ''}
          onChange={(e) => handleChapterChange(e.target.value)}
          className="w-full bg-white/10 border border-white/10 rounded-md px-2 py-1.5 text-xs text-white"
        >
          {flatChapters.length === 0 && <option value="">No chapters available</option>}
          {flatChapters.map(f => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <IconButton size="sm" aria-label="Previous page" onClick={goPrev} disabled={clampedIndex <= 0} className="!bg-transparent !text-white/70 hover:!text-white">
              <ChevronLeft size={14} />
            </IconButton>
            <span className="text-[11px] text-white/50 px-1 tabular-nums">
              {pageCount > 0 ? `Page ${clampedIndex + 1} of ${pageCount}` : 'No pages'}
            </span>
            <IconButton size="sm" aria-label="Next page" onClick={goNext} disabled={clampedIndex >= pageCount - 1} className="!bg-transparent !text-white/70 hover:!text-white">
              <ChevronRight size={14} />
            </IconButton>
          </div>
          <IconButton size="sm" aria-label="Upload reference image" onClick={() => fileInputRef.current?.click()} className="!bg-transparent !text-white/70 hover:!text-white">
            <Upload size={14} />
          </IconButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            onChange={handleFileChosen}
            className="hidden"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4">
        {uploadedPreviewUrl ? (
          uploadedIsPdf ? (
            <embed src={uploadedPreviewUrl} type="application/pdf" className="w-full h-full rounded-sm shadow-lg" />
          ) : (
            <img src={uploadedPreviewUrl} alt="Uploaded reference" className="max-w-full max-h-full rounded-sm shadow-lg" />
          )
        ) : currentImage ? (
          <img src={currentImage.dataUrl} alt={currentPage?.id ?? 'page'} className="max-w-full max-h-full rounded-sm shadow-lg" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-white/40">
            <ImageOff size={28} strokeWidth={1.5} />
            <span className="text-xs">{hasSelection ? 'No pages in this chapter' : 'Select a chapter to preview pages'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
