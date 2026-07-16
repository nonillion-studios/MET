import { get, set } from 'idb-keyval';

export interface ColorPalette {
  id: string;
  name: string;
  colors: string[];
}

const STORAGE_KEY = 'color_palettes';

export async function loadPalettes(): Promise<ColorPalette[]> {
  const saved = await get(STORAGE_KEY);
  return Array.isArray(saved) ? saved : [];
}

export async function savePalettes(palettes: ColorPalette[]): Promise<void> {
  await set(STORAGE_KEY, palettes);
}
