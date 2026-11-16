import { useState, useEffect } from 'react';
import { Modal, Button } from '../ui';

export interface StudioPreferences {
  gridSize: number;
  rulerStep: number;
  guideColor: string;
  gridColor: string;
  autoSaveInterval: number;
}

const STORAGE_KEY = 'studio_preferences';

const DEFAULTS: StudioPreferences = {
  gridSize: 100,
  rulerStep: 100,
  guideColor: '#00ffff',
  gridColor: '#00aaff',
  autoSaveInterval: 30,
};

export function loadPreferences(): StudioPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePreferences(prefs: StudioPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

interface PreferencesDialogProps {
  open: boolean;
  onClose: () => void;
  preferences: StudioPreferences;
  onSave: (prefs: StudioPreferences) => void;
}

export function PreferencesDialog({ open, onClose, preferences, onSave }: PreferencesDialogProps) {
  const [draft, setDraft] = useState<StudioPreferences>(preferences);

  useEffect(() => {
    if (open) setDraft(preferences);
  }, [open, preferences]);

  function handleSave() {
    onSave(draft);
    onClose();
  }

  function handleReset() {
    setDraft({ ...DEFAULTS });
  }

  return (
    <Modal open={open} onClose={onClose} title="Preferences" size="md">
      <div className="flex flex-col gap-4 text-sm">
        <fieldset className="border border-hairline rounded-lg p-3">
          <legend className="px-2 text-micro font-semibold text-ink-faint">Grid & Guides</legend>
          <div className="grid grid-cols-[1fr_auto] gap-3 items-center">
            <label htmlFor="pref-grid-size">Grid Size (px)</label>
            <input
              id="pref-grid-size"
              type="number"
              min={10}
              max={500}
              step={10}
              value={draft.gridSize}
              onChange={(e) => setDraft(d => ({ ...d, gridSize: Math.max(10, Number(e.target.value) || 100) }))}
              className="w-20 bg-ink/5 border border-hairline rounded-control px-2 py-1 text-ink tabular-nums text-right"
            />
            <label htmlFor="pref-ruler-step">Ruler Step (px)</label>
            <input
              id="pref-ruler-step"
              type="number"
              min={10}
              max={500}
              step={10}
              value={draft.rulerStep}
              onChange={(e) => setDraft(d => ({ ...d, rulerStep: Math.max(10, Number(e.target.value) || 100) }))}
              className="w-20 bg-ink/5 border border-hairline rounded-control px-2 py-1 text-ink tabular-nums text-right"
            />
            <label htmlFor="pref-grid-color">Grid Color</label>
            <input
              id="pref-grid-color"
              type="color"
              value={draft.gridColor}
              onChange={(e) => setDraft(d => ({ ...d, gridColor: e.target.value }))}
              className="w-10 h-7 rounded cursor-pointer border border-hairline"
            />
            <label htmlFor="pref-guide-color">Guide Color</label>
            <input
              id="pref-guide-color"
              type="color"
              value={draft.guideColor}
              onChange={(e) => setDraft(d => ({ ...d, guideColor: e.target.value }))}
              className="w-10 h-7 rounded cursor-pointer border border-hairline"
            />
          </div>
        </fieldset>

        <fieldset className="border border-hairline rounded-lg p-3">
          <legend className="px-2 text-micro font-semibold text-ink-faint">Performance</legend>
          <div className="grid grid-cols-[1fr_auto] gap-3 items-center">
            <label htmlFor="pref-autosave">Auto-Save Interval (seconds)</label>
            <input
              id="pref-autosave"
              type="number"
              min={5}
              max={300}
              step={5}
              value={draft.autoSaveInterval}
              onChange={(e) => setDraft(d => ({ ...d, autoSaveInterval: Math.max(5, Number(e.target.value) || 30) }))}
              className="w-20 bg-ink/5 border border-hairline rounded-control px-2 py-1 text-ink tabular-nums text-right"
            />
          </div>
        </fieldset>
      </div>

      <div className="flex justify-between mt-5">
        <Button variant="ghost" onClick={handleReset}>Reset to Defaults</Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
