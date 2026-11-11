import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Trash2, Download, DownloadCloud, Check, Loader2 } from 'lucide-react';
import { IconButton, Skeleton } from '../ui';
import { swalToast } from '../../lib/swalTheme';
import { genId } from '../../lib/id';
import { loadCustomFont, extractFontsFromZip, arrayBufferToDataUrl, registerStoredFont } from '../../lib/fontLoader';
import { type StoredFont } from '../../lib/fontsStore';
import { CURATED_GOOGLE_FONTS, fetchGoogleFont, type CuratedGoogleFont } from '../../lib/googleFonts';
import { useRegisteredCustomFonts } from '../../hooks/useRegisteredCustomFonts';
import { StudioPanel } from './StudioPanel';

interface FontsPanelProps {
  onFamiliesChange: (families: string[]) => void;
  /** Set when hosted inside the right-column panel stack, whose own header already shows the name. */
  hideTitle?: boolean;
}

/** Font manager: install fonts from uploaded files or ZIP archives (FontFace API + opentype.js
 *  metadata parsing), or download from a curated list of free Google Fonts; preview, remove.
 *  Registered families flow into the Text/TypeR font pickers via onFamiliesChange. Google Fonts
 *  are downloaded once via lib/googleFonts.ts and cached in IndexedDB exactly like an upload —
 *  no further network access is needed after that, keeping this app's offline-first guarantee
 *  intact once a font has actually been installed. */
export function FontsPanel({ onFamiliesChange, hideTitle }: FontsPanelProps) {
  const { fonts, loaded, addFonts, removeFont: removeStoredFont } = useRegisteredCustomFonts();
  const [busy, setBusy] = useState(false);
  const [downloadingFamily, setDownloadingFamily] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const familyNames = useMemo(() => fonts.map(f => f.family), [fonts]);
  useEffect(() => { if (loaded) onFamiliesChange(familyNames); }, [loaded, familyNames, onFamiliesChange]);

  const installedFamilies = useMemo(() => new Set(familyNames), [familyNames]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    // Snapshot the FileList *before* resetting the input: `files` is live, so
    // clearing `value` first empties it and the upload silently no-ops.
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    try {
      const added: StoredFont[] = [];
      let skippedCount = 0;
      for (const file of files) {
        try {
          if (file.name.toLowerCase().endsWith('.zip')) {
            const { loaded: fromZip, skipped } = await extractFontsFromZip(file);
            added.push(...fromZip.map(({ family, dataUrl }) => ({ id: genId('font'), family, dataUrl })));
            skippedCount += skipped.length;
          } else {
            const { family, dataUrl } = await loadCustomFont(file);
            added.push({ id: genId('font'), family, dataUrl });
          }
        } catch (err) {
          console.error(err);
          swalToast({ icon: 'error', title: `Couldn't load "${file.name}"` });
        }
      }
      if (added.length > 0) {
        await addFonts(added);
        swalToast({ icon: 'success', title: `Installed ${added.length} font(s)` });
      }
      if (skippedCount > 0) {
        swalToast({ icon: 'warning', title: `${skippedCount} file(s) in the ZIP weren't usable fonts` });
      }
    } finally {
      setBusy(false);
    }
  }

  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  async function removeFont(id: string) {
    setConfirmRemoveId(id);
  }
  async function confirmRemove() {
    if (!confirmRemoveId) return;
    await removeStoredFont(confirmRemoveId);
    setConfirmRemoveId(null);
  }

  async function downloadGoogleFont(entry: CuratedGoogleFont) {
    if (installedFamilies.has(entry.family)) return;
    setDownloadingFamily(entry.family);
    try {
      const buffer = await fetchGoogleFont(entry.family, { preferredScript: entry.preferredScript });
      const dataUrl = arrayBufferToDataUrl(buffer);
      await registerStoredFont(entry.family, dataUrl);
      await addFonts([{ id: genId('font'), family: entry.family, dataUrl }]);
      swalToast({ icon: 'success', title: `Downloaded "${entry.family}"` });
    } catch (err) {
      console.error(err);
      swalToast({ icon: 'error', title: `Couldn't download "${entry.family}"`, text: err instanceof Error ? err.message : 'Check your connection and try again.' });
    } finally {
      setDownloadingFamily(null);
    }
  }

  async function downloadAllGoogleFonts() {
    const pending = CURATED_GOOGLE_FONTS.filter(f => !installedFamilies.has(f.family));
    if (pending.length === 0) return;
    setDownloadingAll(true);
    let succeeded = 0;
    // Sequential, not parallel — avoids hammering Google's endpoint with a burst of simultaneous
    // requests, and keeps the per-row spinner (downloadingFamily) meaningful one font at a time.
    for (const entry of pending) {
      setDownloadingFamily(entry.family);
      try {
        const buffer = await fetchGoogleFont(entry.family, { preferredScript: entry.preferredScript });
        const dataUrl = arrayBufferToDataUrl(buffer);
        await registerStoredFont(entry.family, dataUrl);
        await addFonts([{ id: genId('font'), family: entry.family, dataUrl }]);
        succeeded += 1;
      } catch (err) {
        console.error(err);
      }
    }
    setDownloadingFamily(null);
    setDownloadingAll(false);
    const failed = pending.length - succeeded;
    swalToast({
      icon: failed === 0 ? 'success' : 'warning',
      title: failed === 0
        ? `Downloaded ${succeeded} font(s)`
        : `Downloaded ${succeeded}/${pending.length} font(s) (${failed} failed — check your connection)`,
    });
  }

  if (!loaded) {
    return (
      <StudioPanel title="Fonts" hideTitle={hideTitle} bodyClassName="!gap-2">
        <div className="space-y-1.5 p-1">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7" />)}
        </div>
      </StudioPanel>
    );
  }

  return (
    <StudioPanel
      title="Fonts"
      hideTitle={hideTitle}
      bodyClassName="!gap-2"
      actions={
        <>
          <IconButton
            size="sm"
            aria-label="Download all curated fonts"
            title="Download all curated Google Fonts"
            disabled={downloadingAll || CURATED_GOOGLE_FONTS.every(f => installedFamilies.has(f.family))}
            onClick={downloadAllGoogleFonts}
            className="!bg-transparent"
          >
            {downloadingAll ? <Loader2 size={13} className="animate-spin" /> : <DownloadCloud size={13} />}
          </IconButton>
          <IconButton size="sm" aria-label="Install font" title="Install font (TTF/OTF/WOFF/ZIP)" disabled={busy} onClick={() => inputRef.current?.click()} className="!bg-transparent">
            <Upload size={13} />
          </IconButton>
          <input ref={inputRef} type="file" accept=".ttf,.otf,.woff,.woff2,.zip" multiple className="hidden" onChange={handleUpload} />
        </>
      }
    >
      <div className="contents">
        {fonts.length === 0 && (
          <p className="text-micro text-ink-faint text-center py-2">No custom fonts installed. Upload TTF/OTF/WOFF/ZIP files, or download one below, to use it in Text and TypeR.</p>
        )}
        {fonts.map(f => (
          <div key={f.id} className="flex items-center justify-between gap-2 rounded-control border border-hairline bg-ink/5 px-2.5 py-2">
            <div className="min-w-0">
              <p className="text-ui text-ink truncate" style={{ fontFamily: f.family }}>{f.family}</p>
              <p className="text-[15px] text-ink truncate" style={{ fontFamily: f.family }}>The quick brown fox</p>
            </div>
            <IconButton size="sm" aria-label={`Remove ${f.family}`} onClick={() => removeFont(f.id)} className="!bg-transparent !w-7 !h-7 shrink-0 hover:!text-danger">
              <Trash2 size={12} />
            </IconButton>
          </div>
        ))}

        <p className="text-micro text-ink-faint pt-2 border-t border-hairline mt-1">Browse fonts</p>
        <p className="text-[10px] text-ink-faint/70 -mt-1">Free, downloaded once and cached — no network needed after that.</p>
        {CURATED_GOOGLE_FONTS.map(entry => {
          const installed = installedFamilies.has(entry.family);
          const downloading = downloadingFamily === entry.family;
          return (
            <div key={entry.family} className="flex items-center justify-between gap-2 rounded-control border border-hairline bg-ink/5 px-2.5 py-2">
              <div className="min-w-0">
                <p className="text-ui text-ink truncate" style={installed ? { fontFamily: entry.family } : undefined}>{entry.family}</p>
                <p className="text-micro text-ink-faint capitalize">{entry.category}</p>
              </div>
              {installed ? (
                <span className="shrink-0 text-accent" title="Installed"><Check size={14} /></span>
              ) : (
                <IconButton
                  size="sm"
                  aria-label={`Download ${entry.family}`}
                  title={`Download ${entry.family}`}
                  disabled={downloading || downloadingAll}
                  onClick={() => downloadGoogleFont(entry)}
                  className="!bg-transparent !w-7 !h-7 shrink-0"
                >
                  {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                </IconButton>
              )}
            </div>
          );
        })}
      </div>
      {confirmRemoveId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30" onClick={() => setConfirmRemoveId(null)}>
          <div className="bg-surface border border-hairline rounded-xl p-4 shadow-xl min-w-[240px]" onClick={(e) => e.stopPropagation()}>
            <div className="text-small font-semibold text-ink mb-3">Remove this font?</div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmRemoveId(null)} className="px-3 py-1.5 text-small text-ink-faint hover:text-ink rounded-control">Cancel</button>
              <button type="button" onClick={confirmRemove} className="px-3 py-1.5 text-small bg-red-500 text-white rounded-control hover:bg-red-600">Remove</button>
            </div>
          </div>
        </div>
      )}
    </StudioPanel>
  );
}
