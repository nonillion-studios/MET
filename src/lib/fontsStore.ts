import { get, set } from 'idb-keyval';

export interface StoredFont {
  id: string;
  family: string;
  dataUrl: string;
}

const STORAGE_KEY = 'custom_fonts';

export async function loadStoredFonts(): Promise<StoredFont[]> {
  const saved = await get(STORAGE_KEY);
  return Array.isArray(saved) ? saved : [];
}

export async function saveStoredFonts(fonts: StoredFont[]): Promise<void> {
  await set(STORAGE_KEY, fonts);
}
