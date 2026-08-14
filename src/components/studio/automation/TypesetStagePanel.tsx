import { useRef, useState } from 'react';
import { UploadCloud, Loader2 } from 'lucide-react';
import { Switch } from '../../ui';
import { FONT_FAMILIES } from '../studioTypes';
import { loadCustomFont } from '../../../lib/fontLoader';
import { loadStoredFonts, saveStoredFonts, type StoredFont } from '../../../lib/fontsStore';
import { genId } from '../../../lib/id';
import { swalToast } from '../../../lib/swalTheme';
import type { TypesetStageConfig } from './automationTypes';

interface TypesetStagePanelProps {
  config: TypesetStageConfig;
  onChange: (config: TypesetStageConfig) => void;
  translateEnabled: boolean;
  /** Studio's live custom-font list (`Studio.tsx`'s `customFontFamilies`) — kept here instead of
   *  re-reading storage independently so an upload from this panel is instantly reflected in every
   *  other font picker in the app (Text/TypeR panels) without needing a reload. */
  customFontFamilies: string[];
  onCustomFontFamiliesChange: (families: string[]) => void;
}

/** Uploads happen inline, right here — not via a link out to the (separate, dock-hidden-behind-
 *  this-modal) Fonts panel, which is unreachable while this modal is open. Same upload mechanics as
 *  FontsPanel.tsx (FontFace API + opentype.js metadata + idb-keyval persistence via fontsStore.ts),
 *  just relocated so "upload a font for this pipeline" doesn't require leaving the wizard. */
export function TypesetStagePanel({ config, onChange, translateEnabled, customFontFamilies, onCustomFontFamiliesChange }: TypesetStagePanelProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const availableFonts = [...FONT_FAMILIES, ...customFontFamilies.filter(f => !FONT_FAMILIES.includes(f))];

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    try {
      const existing = await loadStoredFonts();
      const added: StoredFont[] = [];
      for (const file of files) {
        try {
          const { family, dataUrl } = await loadCustomFont(file);
          added.push({ id: genId('font'), family, dataUrl });
        } catch (err) {
          console.error(err);
          swalToast({ icon: 'error', title: `Couldn't load "${file.name}"` });
        }
      }
      if (added.length > 0) {
        const next = [...existing, ...added];
        await saveStoredFonts(next);
        onCustomFontFamiliesChange(next.map(f => f.family));
        // Default the just-uploaded font straight into the picker it was most likely meant for —
        // saves a second trip through the dropdown for the common "just uploaded Marhey" case.
        onChange({ ...config, dialogueFontFamily: added[0].family });
        swalToast({ icon: 'success', title: `Installed ${added.length} font${added.length === 1 ? '' : 's'}` });
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-ui font-semibold text-ink mb-1">Typesetting</h3>
          <p className="text-micro text-ink-faint">
            Corrects Gemini's bubble guesses with the same flood-fill bubble detector "Center in Bubble" uses, then
            shrinks each bubble's text to fit — Arabic text is additionally kashida-justified.
          </p>
        </div>
        <Switch checked={config.enabled} onChange={(enabled) => onChange({ ...config, enabled })} aria-label="Enable Typesetting stage" disabled={!translateEnabled} />
      </div>

      {!translateEnabled && (
        <p className="text-micro text-warning">Enable Translation first — Typesetting places whatever it finds.</p>
      )}

      {config.enabled && (
        <>
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-control border border-hairline bg-ink/5">
            <span className="text-micro text-ink-faint">
              {customFontFamilies.length > 0 ? `${customFontFamilies.length} custom font${customFontFamilies.length === 1 ? '' : 's'} available` : 'No custom fonts uploaded yet'} —
              only fonts already loaded in Studio can be used here.
            </span>
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-control border border-hairline bg-ink/5 text-ui font-medium text-ink hover:bg-ink/10 transition-colors disabled:opacity-50"
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />}
              Upload a font
            </button>
            <input ref={inputRef} type="file" accept=".ttf,.otf,.woff,.woff2" multiple className="hidden" onChange={handleUpload} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>Dialogue font (same for every bubble)</span>
              <select
                value={config.dialogueFontFamily}
                onChange={(e) => onChange({ ...config, dialogueFontFamily: e.target.value })}
                className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
              >
                {availableFonts.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>SFX font</span>
              <select
                value={config.sfxFontFamily}
                onChange={(e) => onChange({ ...config, sfxFontFamily: e.target.value })}
                className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
              >
                {availableFonts.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>Default text color <span className="opacity-70">(Gemini may override per bubble)</span></span>
              <input type="color" value={config.color} onChange={(e) => onChange({ ...config, color: e.target.value })} className="h-8 w-full rounded-control border border-hairline" />
            </label>
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>Default stroke color <span className="opacity-70">(Gemini may override per bubble)</span></span>
              <input type="color" value={config.strokeColor} onChange={(e) => onChange({ ...config, strokeColor: e.target.value })} className="h-8 w-full rounded-control border border-hairline" />
            </label>
            <label className="flex flex-col gap-1 text-micro text-ink-faint sm:col-span-2">
              <span className="flex items-center justify-between"><span>Default stroke width <span className="opacity-70">(Gemini may override per bubble)</span></span><span className="tabular-nums">{config.strokeWidth}px</span></span>
              <input type="range" min={0} max={8} step={0.5} value={config.strokeWidth} onChange={(e) => onChange({ ...config, strokeWidth: Number(e.target.value) })} className="accent-accent" />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
