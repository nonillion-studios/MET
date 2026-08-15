import { useEffect, useMemo, useState } from 'react';
import { loadStoredFonts, saveStoredFonts, type StoredFont } from '../lib/fontsStore';
import { registerStoredFont } from '../lib/fontLoader';

/**
 * Loads previously-installed custom fonts from IndexedDB and re-registers them with the
 * page-global `document.fonts` registry on mount — every page that can render custom-font text
 * has to do this itself, since `document.fonts` doesn't persist across a reload. Also owns
 * add/remove so every caller shares one persistence path instead of duplicating it (previously
 * FontsPanel.tsx and TextEditorPage.tsx each had their own near-identical copy).
 */
export function useRegisteredCustomFonts() {
  const [fonts, setFonts] = useState<StoredFont[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadStoredFonts().then(async (stored) => {
      await Promise.all(stored.map(f => registerStoredFont(f.family, f.dataUrl).catch((err) => {
        console.error(`Failed to re-register font "${f.family}"`, err);
      })));
      setFonts(stored);
      setLoaded(true);
    });
  }, []);

  const familyNames = useMemo(() => fonts.map(f => f.family), [fonts]);

  async function addFonts(added: StoredFont[]) {
    const next = [...fonts, ...added];
    setFonts(next);
    await saveStoredFonts(next);
    return next;
  }

  async function removeFont(id: string) {
    const next = fonts.filter(f => f.id !== id);
    setFonts(next);
    await saveStoredFonts(next);
    return next;
  }

  return { fonts, familyNames, loaded, addFonts, removeFont };
}
