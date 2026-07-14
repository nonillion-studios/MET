import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { IconButton } from '../ui';
import { swal, swalToast } from '../../lib/swalTheme';
import { genId } from '../../lib/id';
import { loadCustomFont, registerStoredFont } from '../../lib/fontLoader';
import { loadStoredFonts, saveStoredFonts, type StoredFont } from '../../lib/fontsStore';

interface FontsPanelProps {
  onFamiliesChange: (families: string[]) => void;
}

/** Font manager: install fonts from uploaded files (FontFace API + opentype.js metadata
 *  parsing), preview, remove. Registered families flow into the Text/TypeR font pickers via
 *  onFamiliesChange. Google Fonts integration is optional per SPEC and out of scope here —
 *  this app must keep working fully offline, and a Google Fonts picker needs network access
 *  by definition. */
export function FontsPanel({ onFamiliesChange }: FontsPanelProps) {
  const [fonts, setFonts] = useState<StoredFont[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadStoredFonts().then(async (stored) => {
      await Promise.all(stored.map(f => registerStoredFont(f.family, f.dataUrl).catch((err) => {
        console.error(`Failed to re-register font "${f.family}"`, err);
      })));
      setFonts(stored);
      onFamiliesChange(stored.map(f => f.family));
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    e.target.value = '';
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const added: StoredFont[] = [];
      for (const file of Array.from(files)) {
        try {
          const { family, dataUrl } = await loadCustomFont(file);
          added.push({ id: genId('font'), family, dataUrl });
        } catch (err) {
          console.error(err);
          swalToast({ icon: 'error', title: `Couldn't load "${file.name}"` });
        }
      }
      if (added.length > 0) {
        const next = [...fonts, ...added];
        setFonts(next);
        onFamiliesChange(next.map(f => f.family));
        await saveStoredFonts(next);
        swalToast({ icon: 'success', title: `Installed ${added.length} font(s)` });
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeFont(id: string) {
    const result = await swal({ icon: 'warning', title: 'Remove this font?', showCancelButton: true, confirmButtonText: 'Remove' });
    if (!result.isConfirmed) return;
    const next = fonts.filter(f => f.id !== id);
    setFonts(next);
    onFamiliesChange(next.map(f => f.family));
    await saveStoredFonts(next);
  }

  if (!loaded) return null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-hairline">
        <span className="text-xs font-display font-semibold text-ink-faint uppercase tracking-wide">Fonts</span>
        <IconButton size="sm" aria-label="Install font" title="Install font (TTF/OTF/WOFF)" disabled={busy} onClick={() => inputRef.current?.click()} className="!bg-transparent">
          <Upload size={13} />
        </IconButton>
        <input ref={inputRef} type="file" accept=".ttf,.otf,.woff,.woff2" multiple className="hidden" onChange={handleUpload} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-2">
        {fonts.length === 0 && (
          <p className="text-[11px] text-ink-faint text-center py-6">No custom fonts installed. Upload TTF/OTF/WOFF files to use them in Text and TypeR.</p>
        )}
        {fonts.map(f => (
          <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-ink/[0.03] px-2.5 py-2">
            <div className="min-w-0">
              <p className="text-xs text-ink truncate" style={{ fontFamily: f.family }}>{f.family}</p>
              <p className="text-[15px] text-ink truncate" style={{ fontFamily: f.family }}>The quick brown fox</p>
            </div>
            <IconButton size="sm" aria-label={`Remove ${f.family}`} onClick={() => removeFont(f.id)} className="!bg-transparent !w-7 !h-7 shrink-0 hover:!text-danger">
              <Trash2 size={12} />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}
