import { useEffect, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Switch, Button } from '../../ui';
import { FONT_FAMILIES } from '../studioTypes';
import { loadStoredFonts } from '../../../lib/fontsStore';
import type { TypesetStageConfig } from './automationTypes';

interface TypesetStagePanelProps {
  config: TypesetStageConfig;
  onChange: (config: TypesetStageConfig) => void;
  translateEnabled: boolean;
  /** Reveals the Fonts panel (right dock) so the user can upload a font — e.g. an Arabic typeface
   *  like Marhey — that then shows up in the dropdowns below. This app's font system is
   *  deliberately offline/upload-only (see FontsPanel.tsx), so nothing here can fetch or bundle a
   *  font on its own; typesetting only ever picks from what's actually loaded. */
  onOpenFontsPanel: () => void;
}

export function TypesetStagePanel({ config, onChange, translateEnabled, onOpenFontsPanel }: TypesetStagePanelProps) {
  const [customFonts, setCustomFonts] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadStoredFonts().then(fonts => {
      if (!cancelled) setCustomFonts(fonts.map(f => f.family));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Every font the pipeline is allowed to pick from — built-in plus whatever the user has uploaded
  // — so typesetting can never reference a font that isn't actually loaded in the app.
  const availableFonts = [...FONT_FAMILIES, ...customFonts.filter(f => !FONT_FAMILIES.includes(f))];

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
              {customFonts.length > 0 ? `${customFonts.length} custom font${customFonts.length === 1 ? '' : 's'} available` : 'No custom fonts uploaded yet'} —
              only fonts already loaded in Studio can be used here.
            </span>
            <Button variant="secondary" size="sm" onClick={onOpenFontsPanel} className="shrink-0">
              <UploadCloud size={13} /> Upload a font
            </Button>
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
              <span>Text color</span>
              <input type="color" value={config.color} onChange={(e) => onChange({ ...config, color: e.target.value })} className="h-8 w-full rounded-control border border-hairline" />
            </label>
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>Stroke color</span>
              <input type="color" value={config.strokeColor} onChange={(e) => onChange({ ...config, strokeColor: e.target.value })} className="h-8 w-full rounded-control border border-hairline" />
            </label>
            <label className="flex flex-col gap-1 text-micro text-ink-faint sm:col-span-2">
              <span className="flex items-center justify-between"><span>Stroke width</span><span className="tabular-nums">{config.strokeWidth}px</span></span>
              <input type="range" min={0} max={8} step={0.5} value={config.strokeWidth} onChange={(e) => onChange({ ...config, strokeWidth: Number(e.target.value) })} className="accent-accent" />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
